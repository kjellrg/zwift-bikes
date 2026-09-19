import type { H3Event } from 'h3'

/**
 * The rate-limit decision itself, separated from the middleware that decides
 * which paths deserve it (`server/middleware/rate-limit.ts`) so a second
 * caller can reuse the same budget.
 *
 * That second caller is the markdown negotiation middleware
 * (`server/middleware/01.markdown.ts`): it answers a PAGE url, so the
 * path-based middleware below would never see it, yet rendering one runs the
 * same recommend pipeline `/api/recommend/**` is limited for. Left
 * uncounted, `GET /routes/x` with an `Accept` header would have been an
 * unmetered door to the metered endpoint - and because that middleware
 * returns its response, the middleware chain never reaches the limiter on
 * its own.
 *
 * Everything about the binding, the key and the failure mode is documented
 * on the middleware; this module is only the call.
 */

/**
 * The Workers rate limiting binding - `{ success: false }` means this key is
 * over the window's budget. Hand-declared rather than pulled from
 * `@cloudflare/workers-types`: that package's ambient globals (fetch,
 * Request, Response, ...) would fight the Node types everywhere else.
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

/**
 * Counts this request against the caller's budget and throws a 429 when it
 * is over.
 *
 * Silently allows the request where there is nothing to count with: no
 * Workers binding (nuxt dev, vitest, the prerender crawl, and Nitro's
 * in-process `$fetch`, which carries no platform context) or no
 * `cf-connecting-ip`. That absence is what exempts internal traffic by
 * construction - one external call costs exactly one count, not one per
 * internal fetch it fans out into.
 */
export async function enforceRateLimit(event: H3Event): Promise<void> {
  const limiter = (event.context.cloudflare as { env?: { RECOMMEND_RATE_LIMITER?: RateLimitBinding } } | undefined)?.env?.RECOMMEND_RATE_LIMITER
  const ip = getRequestHeader(event, 'cf-connecting-ip')
  if (!limiter || !ip) return

  const { success } = await limiter.limit({ key: ip })
  if (success) return

  setResponseHeader(event, 'Retry-After', RETRY_AFTER_SEC)
  throw createError({
    statusCode: 429,
    statusMessage: 'Too Many Requests',
    message: 'Rate limit exceeded for this endpoint. Try again shortly.'
  })
}
