import type { H3Event } from 'h3'
import { getSiteFlags } from '../utils/siteFlags'

/**
 * Enforces the runtime site flags (`server/utils/siteFlags.ts`) at the API
 * layer: the client-side hiding in `useSiteFlags` is presentation, this is
 * the part that actually stops requests. Two kinds of gate:
 *
 * - Kill switches for the endpoints that cost real CPU money or can serve
 *   wrong answers during a data incident (`/api/recommend/**`, `/api/mcp`).
 * - Section gates: a hidden section's data endpoints close along with its
 *   pages (`/api/events/**`), so the section is off, not just unlinked.
 *
 * Everything answers 503 + Retry-After rather than 404: these are temporary
 * operational states, and a 503 tells crawlers and the refetch composable
 * alike to come back later, not to forget the URL.
 *
 * Runs after `rate-limit.ts` (Nitro orders middleware by filename), so a
 * kill-switched endpoint still counts against an abuser's rate budget.
 * Prerender crawls and dev carry no KV binding, so `getSiteFlags` resolves
 * to defaults there and this middleware never blocks a build.
 */

const RETRY_AFTER_SEC = 300

function unavailable(event: H3Event, message: string): never {
  setResponseHeader(event, 'Retry-After', RETRY_AFTER_SEC)
  throw createError({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    message
  })
}

export default defineEventHandler(async (event) => {
  if (import.meta.prerender) return
  const path = event.path.split('?')[0] ?? ''
  const isRecommend = path.startsWith('/api/recommend/')
  const isMcp = path === '/api/mcp'
  const isEvents = path.startsWith('/api/events/')
  if (!isRecommend && !isMcp && !isEvents) return

  const { killSwitches, sections } = await getSiteFlags(event)
  if (isRecommend && killSwitches.recommend) {
    // No trailing "try again" imperative: useRefetchNotice shows this text
    // verbatim in a toast and appends its own stale-results line.
    unavailable(event, 'Recommendations are temporarily paused for maintenance.')
  }
  if (isMcp && killSwitches.mcp) {
    unavailable(event, 'The MCP endpoint is temporarily paused for maintenance. Try again shortly.')
  }
  if (isEvents && sections.events.mode === 'hidden') {
    unavailable(event, sections.events.notice ?? 'The events calendar is temporarily unavailable.')
  }
})
