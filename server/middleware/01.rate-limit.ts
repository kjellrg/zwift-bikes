import type { H3Event } from 'h3'
import { markdownDocumentFor } from '../utils/markdown/documents'
import { prefersMarkdown } from '../utils/markdown/negotiate'

/**
 * Best-effort rate limiting for the expensive requests. Three shapes of them
 * reach this middleware:
 *
 * - `/api/recommend/**`, which runs a physics simulation per candidate combo.
 * - `/api/mcp`, the unauthenticated public MCP endpoint.
 * - A page URL that asked for markdown, which runs that same pipeline behind
 *   a page path - `GET /routes/x` with `Accept: text/markdown` costs what an
 *   `/api/recommend/**` request costs (see `02.markdown.ts`).
 *
 * Everything else (catalog lookups, pages as HTML) is cheap enough not to
 * bother. The HTML at those same page URLs is prerendered bytes handed back
 * by the asset binding, so metering it would spend a rider's budget on
 * traffic that costs nothing to serve - which is exactly why the markdown
 * test below reads the `Accept` header and not just the path.
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
 * ## Why the markdown pages are metered here rather than at the zone
 *
 * Telling a markdown request from a browser's at the edge means reading
 * `Accept`, and `http.request.headers` inside a rate-limiting rule needs
 * Advanced Rate Limiting (Business/Enterprise). On this zone's plan a rule
 * can only match the path, which is `/routes/x` for both - so it would
 * either miss every agent or meter every reader. The header costs nothing to
 * read here, so the budget lives here, in the one place the rest of the
 * site's rate limiting already lives.
 *
 * A path-matched zone rule on `/api/recommend` does not catch the pipeline
 * run behind a markdown request either, for a second and independent reason:
 * it goes out over Nitro's in-process `$fetch` and never crosses the edge.
 *
 * ## Internal traffic is exempt by construction
 *
 * Nitro's in-process `$fetch` (SSR page renders, the prerender crawl, the
 * MCP tools' and the markdown documents' in-process API calls - which DO
 * pass through this middleware) never carries the Workers platform context,
 * so `limiter` resolves to undefined for it - and the same absence covers
 * `nuxt dev`, where no binding exists either. One external MCP call or
 * markdown page request therefore costs exactly one count, not one per
 * internal fetch it fans out into.
 *
 * ## Ordering
 *
 * Nitro orders middleware by filename, so this runs before `02.markdown.ts`
 * - which is what lets it meter a markdown request at all, since that
 * middleware returns a response and ends the chain. It also runs ahead of
 * `origin-gate.ts` and `site-flags-gate.ts`, so a request they reject still
 * counts against an abuser's budget.
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

/**
 * Whether this request is one of the expensive ones. `markdownDocumentFor`
 * rather than `isWorkerFirstPath` is what decides the markdown case: the
 * `/events/*` rule sweeps in season pages that have no document and are
 * handed straight back to the assets, and those cost nothing. Documents that
 * only read the catalog (`/`, `/segments`) are counted along with the ones
 * that rank - three URLs out of hundreds, not worth a second class of
 * metered request to exempt.
 */
function isExpensive(event: H3Event, path: string): boolean {
  if (path.startsWith('/api/recommend/') || path === '/api/mcp') return true
  if (!markdownDocumentFor(path)) return false
  return prefersMarkdown(getRequestHeader(event, 'accept'))
}

export default defineEventHandler(async (event) => {
  if (import.meta.prerender) return
  const path = event.path.split('?')[0] ?? ''
  if (!isExpensive(event, path)) return

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
