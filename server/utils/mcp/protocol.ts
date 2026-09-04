import { callTool, listTools } from './tools'

/**
 * Model Context Protocol versions this server can speak. Ordered newest first -
 * `negotiateProtocolVersion` echoes the client's version back when it's one we
 * know, and otherwise answers with `SUPPORTED_PROTOCOL_VERSIONS[0]` so the
 * client can decide whether to continue or disconnect.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26']

export const SERVER_INFO = {
  name: 'zwift-bikes',
  title: 'ZwiftBikes',
  version: '1.0.0'
}

const INSTRUCTIONS = `Predicts which Zwift bike frame + wheelset combination is fastest on a given route or segment, for a specific rider.

Finish-time predictions need the rider's weight (kg), height (cm) and sustained power (W/kg). If you do not have them, ask the user for them, then call \`set_rider_profile\` once - the values are remembered for the rest of the session. Do not guess a rider profile: every predicted time depends on it directly.

Route and segment arguments are slugs (e.g. "watopia-big-foot-hills"). Use \`list_routes\` / \`list_segments\` to find one rather than guessing.`

/** JSON-RPC 2.0 error codes, plus the range MCP reserves for its own. */
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INTERNAL_ERROR = -32603

/**
 * Upper bound on a request body. The largest legitimate message is a
 * `tools/call` carrying a rider profile, a slug and a search string - well
 * under 2 KB - so 16 KB is an order of magnitude of headroom. Without a cap,
 * `readRawBody` + `JSON.parse` would accept anything up to Cloudflare's
 * plan limit (100 MB) and spend a 128 MB isolate's memory on it; the query
 * inputs are all length-capped in `apiQuerySchemas.ts`, and this is the
 * same rule for the one endpoint that reads a body. Issue #160.
 */
export const MCP_MAX_BODY_BYTES = 16 * 1024

/**
 * Whether a request body is over `MCP_MAX_BODY_BYTES`. Checked twice by the
 * transport: on the `Content-Length` header before the body is read, so an
 * oversized declared body is refused without buffering it, and on the raw
 * text after, because a chunked request carries no length header at all.
 */
export function bodyTooLarge(contentLength: string | undefined, raw: string | undefined): boolean {
  const declared = Number(contentLength)
  if (Number.isFinite(declared) && declared > MCP_MAX_BODY_BYTES) return true
  return raw !== undefined && new TextEncoder().encode(raw).byteLength > MCP_MAX_BODY_BYTES
}

export interface JsonRpcMessage {
  jsonrpc?: unknown
  id?: string | number | null
  method?: unknown
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number, message: string, data?: unknown }
}

export interface RpcContext {
  sessionId?: string
  /**
   * `killSwitches.recommend` from the runtime site flags, read once per
   * request by the transport. The recommend tools reach their endpoints
   * through Nitro's in-process `$fetch`, whose events carry no Workers
   * platform context and therefore no KV binding - so the middleware gate
   * that 503s `/api/recommend/**` never sees those calls, and the flag has
   * to travel with the request instead (issue #154).
   */
  recommendPaused?: boolean
}

export function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function parseError(): JsonRpcResponse {
  return errorResponse(null, PARSE_ERROR, 'Request body is not valid JSON.')
}

export function payloadTooLarge(): JsonRpcResponse {
  return errorResponse(null, INVALID_REQUEST, `Request body exceeds ${MCP_MAX_BODY_BYTES / 1024} KB.`)
}

export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0]!
}

export function isNotification(message: JsonRpcMessage): boolean {
  return message.id === undefined
}

export function isInitialize(message: JsonRpcMessage): boolean {
  return message.method === 'initialize'
}

/**
 * Dispatches one JSON-RPC message. Returns `undefined` for notifications,
 * which per JSON-RPC take no response at all (the transport answers 202).
 */
export async function handleMessage(message: JsonRpcMessage, context: RpcContext): Promise<JsonRpcResponse | undefined> {
  const id = message.id ?? null

  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return isNotification(message) ? undefined : errorResponse(id, INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 request.')
  }

  const params = (typeof message.params === 'object' && message.params !== null ? message.params : {}) as Record<string, unknown>

  switch (message.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiateProtocolVersion(params.protocolVersion),
          // `listChanged: false` is the honest answer: the catalog is baked
          // into the bundle at build time, so the tool list never changes
          // while a session is open.
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS
        }
      }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: listTools() } }

    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (typeof params.arguments === 'object' && params.arguments !== null ? params.arguments : {}) as Record<string, unknown>
      try {
        return { jsonrpc: '2.0', id, result: await callTool(name, args, context) }
      } catch (error) {
        // A thrown error here is a bug in this server, not a tool-level
        // failure the model can act on - those come back as `isError` results
        // from `callTool` itself. Surface it as a protocol error - but the
        // detail goes to Workers Logs, not to the client: an internal
        // message is a TypeError string or ofetch's "[GET] /api/...: 500"
        // wrapper, implementation detail on a public JSON-RPC surface, where
        // the REST endpoints only ever emit curated `createError` text.
        // Same one-JSON-line shape as the request log in `plugins/timing.ts`.
        console.error(JSON.stringify({
          evt: 'mcp-tool-error',
          tool: name,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }))
        return errorResponse(id, INTERNAL_ERROR, `Tool "${name}" failed. The error has been logged.`)
      }
    }

    default:
      // Notifications we don't handle (e.g. `notifications/initialized`,
      // `notifications/cancelled`) are legitimately ignorable.
      return isNotification(message) ? undefined : errorResponse(id, METHOD_NOT_FOUND, `Unknown method "${message.method}".`)
  }
}
