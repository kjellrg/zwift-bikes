/**
 * Best-effort rate limiting for the expensive endpoints: `/api/recommend/**`
 * runs a physics simulation per candidate combo, and `/api/mcp` is the
 * unauthenticated public MCP endpoint. Everything else (catalog lookups,
 * pages) is cheap enough not to bother.
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
 * platform context, so `limiter` resolves to undefined for it - and the same
 * absence covers `nuxt dev`, where no binding exists either. One external
 * MCP call therefore costs exactly one count, not one per internal fetch it
 * fans out into.
 */

/**
 * The Workers rate limiting binding - `{ success: false }` means this key is
 * over the window's budget. Hand-declared rather than pulled from
 * `@cloudflare/workers-types`: this one method is the only Workers type the
 * codebase needs, and that package's ambient globals (fetch, Request,
 * Response, ...) would fight the Node types everywhere else.
 */
interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/**
 * What a 429 tells the client to wait. The binding does not expose the
 * window's remaining time, so this is the full period from wrangler.jsonc -
 * the honest upper bound. The refetch composable caps its automatic retry at
 * 30s regardless (see app/composables/useRefetchNotice.ts).
 */
const RETRY_AFTER_SEC = 60

export default defineEventHandler(async (event) => {
  if (import.meta.prerender) return
  const path = event.path.split('?')[0] ?? ''
  if (!path.startsWith('/api/recommend/') && path !== '/api/mcp') return

  const limiter = (event.context.cloudflare as { env?: { RECOMMEND_RATE_LIMITER?: RateLimitBinding } } | undefined)?.env?.RECOMMEND_RATE_LIMITER
  const ip = getRequestHeader(event, 'cf-connecting-ip')
  if (!limiter || !ip) return

  const { success } = await limiter.limit({ key: ip })
  if (!success) {
    setResponseHeader(event, 'Retry-After', RETRY_AFTER_SEC)
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      message: 'Rate limit exceeded for this endpoint. Try again shortly.'
    })
  }
})
