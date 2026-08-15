import { endSession } from '../utils/mcp/session'

/**
 * Explicit session termination. Clients aren't required to call this - a
 * session expires on its own idle timeout - but a client that does gets its
 * stored rider profile dropped immediately rather than left in memory.
 */
export default defineEventHandler((event) => {
  const sessionId = getRequestHeader(event, 'mcp-session-id')
  if (sessionId) endSession(sessionId)
  setResponseStatus(event, 204)
  return null
})
