import {
  bodyTooLarge,
  errorResponse,
  handleMessage,
  isInitialize,
  parseError,
  payloadTooLarge,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcMessage
} from '../utils/mcp/protocol'
import { adoptSession, createSession, touchSession } from '../utils/mcp/session'
import { getSiteFlags } from '../utils/siteFlags'

/**
 * Model Context Protocol endpoint, Streamable HTTP transport.
 *
 * Responses are always a single `application/json` JSON-RPC message rather
 * than an SSE stream. The spec permits that, and nothing is lost here - every
 * tool is a synchronous read over a catalog baked into the bundle, so there is
 * no progress to stream and no server-initiated message to deliver.
 *
 * That also means the GET (server-opened stream) half of the transport is
 * genuinely unsupported rather than merely unimplemented - see `mcp.get.ts`.
 */
export default defineEventHandler(async (event) => {
  // Header first, so an oversized declared body is refused unread; raw text
  // second, because a chunked request declares nothing - see `bodyTooLarge`.
  if (bodyTooLarge(getRequestHeader(event, 'content-length'), undefined)) {
    setResponseStatus(event, 413)
    return payloadTooLarge()
  }
  const raw = await readRawBody(event)
  if (bodyTooLarge(undefined, raw)) {
    setResponseStatus(event, 413)
    return payloadTooLarge()
  }

  let message: JsonRpcMessage
  try {
    message = JSON.parse(raw ?? '')
  } catch {
    setResponseStatus(event, 400)
    return parseError()
  }

  // JSON-RPC batching was removed in MCP 2025-06-18, and this server never
  // supported it - reject arrays explicitly rather than silently reading
  // element zero.
  if (Array.isArray(message)) {
    setResponseStatus(event, 400)
    return errorResponse(null, -32600, 'Batched requests are not supported. Send one JSON-RPC message per request.')
  }
  if (typeof message !== 'object' || message === null) {
    setResponseStatus(event, 400)
    return errorResponse(null, -32600, 'Request body must be a JSON-RPC 2.0 object.')
  }

  const requestedSessionId = getRequestHeader(event, 'mcp-session-id')
  let sessionId = requestedSessionId

  if (isInitialize(message)) {
    sessionId = createSession()
    setResponseHeader(event, 'Mcp-Session-Id', sessionId)
  } else if (requestedSessionId && !touchSession(requestedSessionId) && !adoptSession(requestedSessionId)) {
    // Sessions live in one Workers isolate's memory, so an id minted elsewhere
    // is the normal case, not an error - `adoptSession` takes it over rather
    // than 404-ing (see `session.ts`). Only an id we could never have minted
    // gets the spec's "this session is gone, start a new one" signal.
    setResponseStatus(event, 404)
    return errorResponse(message.id ?? null, -32001, 'Unknown or expired MCP session. Re-initialize, then set the rider profile again.')
  }

  // A memo hit: the site-flags gate already read the flags for this very
  // request. Passed down because the tools' internal fetches cannot read
  // them - see `RpcContext.recommendPaused`.
  const { killSwitches } = await getSiteFlags(event)
  const response = await handleMessage(message, { sessionId, recommendPaused: killSwitches.recommend })

  if (!response) {
    // A notification takes no reply at all.
    setResponseStatus(event, 202)
    return null
  }

  setResponseHeader(event, 'Content-Type', 'application/json')
  setResponseHeader(event, 'MCP-Protocol-Version', SUPPORTED_PROTOCOL_VERSIONS[0]!)
  return response
})
