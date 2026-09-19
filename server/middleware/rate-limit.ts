import { enforceRateLimit } from '../utils/rateLimit'

/**
 * Best-effort rate limiting for the expensive endpoints: `/api/recommend/**`
 * runs a physics simulation per candidate combo, and `/api/mcp` is the
 * unauthenticated public MCP endpoint. Everything else (catalog lookups,
 * pages) is cheap enough not to bother - except a page asked for as markdown,
 * which runs the recommend pipeline behind a page URL and is therefore
 * counted by `server/middleware/01.markdown.ts` through the same
 * `enforceRateLimit` this file calls.
 *
 * Backed by the Workers rate limiting binding (`ratelimits` in
 * wrangler.jsonc): 30 requests per 60-second window per client IP, counted
 * per Cloudflare location and eventually consistent. Looser than a global
 * counter, and that's fine - this exists to cap the cost of a single abusive
 * client, not to meter traffic precisely.
 *
 * The client is `cf-connecting-ip`, which Cloudflare's edge sets itself on
 * every request it proxies. A client cannot forge it - unlike
 * `x-forwarded-for`, where everything except the edge-appended last entry is
 * attacker-chosen, which is why keying on that header would hand out both
 * free limit resets (mint a new chain per request) and targeted lockouts
 * (send a victim's address).
 *
 * Internal traffic is exempt by construction: Nitro's in-process `$fetch`
 * (SSR page renders, the prerender crawl, the MCP tools' in-process API
 * calls - which DO pass through this middleware) never carries the Workers
 * platform context, so the binding resolves to undefined for it - and the
 * same absence covers `nuxt dev`, where no binding exists either. One
 * external MCP call therefore costs exactly one count, not one per internal
 * fetch it fans out into.
 */
export default defineEventHandler(async (event) => {
  if (import.meta.prerender) return
  const path = event.path.split('?')[0] ?? ''
  if (!path.startsWith('/api/recommend/') && path !== '/api/mcp') return

  await enforceRateLimit(event)
})
