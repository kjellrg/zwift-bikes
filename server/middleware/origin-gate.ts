/**
 * Rejects cross-site BROWSER requests to the REST endpoints. The API is
 * deliberately public - curl, scripts and server-side callers stay welcome
 * (docs/mcp-server.md documents the data as public and read-only) - but
 * another website's frontend has no business calling it from its visitors'
 * browsers, and `Sec-Fetch-Site` is exactly the signal that distinguishes
 * that case: browsers attach it themselves and JavaScript cannot forge it.
 *
 * Deliberately no `Origin`-header fallback: every evergreen browser has sent
 * `Sec-Fetch-Site` since ~2020, and an Origin-based check would additionally
 * 403 legitimate non-browser clients that happen to set one, for negligible
 * coverage gain.
 *
 * `/api/mcp` is exempt: remote MCP clients (the claude.ai connector,
 * browser-based MCP inspectors) are cross-site by definition and must stay
 * able to reach it. Internal `$fetch` calls (SSR renders, the prerender
 * crawl, the MCP tools' in-process API calls) carry no `Sec-Fetch-*` headers
 * at all, so they pass untouched.
 */
export default defineEventHandler((event) => {
  if (import.meta.prerender) return
  const path = event.path.split('?')[0] ?? ''
  if (!path.startsWith('/api/') || path === '/api/mcp') return
  if (getRequestHeader(event, 'sec-fetch-site') !== 'cross-site') return
  // A person following a link to an API URL from another site is a
  // navigation, not an embedded call - let them see the JSON, not a 403.
  if (getRequestHeader(event, 'sec-fetch-mode') === 'navigate') return
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'Cross-site browser requests to this API are not allowed.'
  })
})
