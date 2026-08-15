/**
 * The Streamable HTTP transport lets a client open a GET stream so the server
 * can push messages it did not solicit. This server never does: every tool is
 * a synchronous read, and responses come back as plain JSON on the POST (see
 * `mcp.post.ts`). The spec's defined answer for a server that doesn't offer
 * the stream is 405, which clients treat as "poll over POST only".
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Allow', 'POST, DELETE')
  throw createError({
    statusCode: 405,
    statusMessage: 'This MCP server does not offer a server-initiated SSE stream. Send JSON-RPC messages by POST.'
  })
})
