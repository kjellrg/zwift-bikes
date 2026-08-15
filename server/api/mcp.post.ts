import {
  errorResponse,
  handleMessage,
  isInitialize,
  parseError,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcMessage
} from '../utils/mcp/protocol'
import { createSession, touchSession } from '../utils/mcp/session'

/**
 * Model Context Protocol endpoint, Streamable HTTP transport.
 *
 * Responses are always a single `application/json` JSON-RPC message rather
 * than an SSE stream. The spec permits that, and it is what this deployment
 * needs: the app runs on Azure Static Web Apps, whose managed functions are a
 * poor host for long-lived streaming connections. Nothing is lost here -
 * every tool is a synchronous read over a catalog baked into the bundle, so
 * there is no progress to stream and no server-initiated message to deliver.
 *
 * That also means the GET (server-opened stream) half of the transport is
 * genuinely unsupported rather than merely unimplemented - see `mcp.get.ts`.
 */
export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event)

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
  } else if (requestedSessionId && !touchSession(requestedSessionId)) {
    // The spec's defined signal for "this session is gone, start a new one".
    // Expected here rather than exceptional: sessions live in one instance's
    // memory, so a cold start or a scale-out loses them (see `session.ts`).
    setResponseStatus(event, 404)
    return errorResponse(message.id ?? null, -32001, 'Unknown or expired MCP session. Re-initialize, then set the rider profile again.')
  }

  const response = await handleMessage(message, { sessionId })

  if (!response) {
    // A notification takes no reply at all.
    setResponseStatus(event, 202)
    return null
  }

  setResponseHeader(event, 'Content-Type', 'application/json')
  setResponseHeader(event, 'MCP-Protocol-Version', SUPPORTED_PROTOCOL_VERSIONS[0]!)
  return response
})
