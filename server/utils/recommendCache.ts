import type { H3Event } from 'h3'
import { RouteSimulationStallError } from '../../shared/utils/physics/simulator'
import { addTimingMeta } from './timing'

/**
 * Edge-cache wrapper for the recommend endpoints, backed by the Workers Cache
 * API (`caches.default` - free, no binding to declare in wrangler.jsonc).
 *
 * A recommend response is a pure function of path + query + the data baked
 * into the deployed bundle: no clock, no KV, no per-request state reaches the
 * output. So a response computed once is correct until the next deploy - and
 * the cache key embeds the build's commit (`buildSha`, the same value the bug
 * reporter shows), which makes cross-deploy staleness structurally impossible
 * instead of a TTL race: a new build simply reads and writes different keys,
 * and the old build's entries age out on their own. That is also why the TTL
 * below can be long without a correctness argument attached.
 *
 * What a hit is worth: these are the endpoints whose worst legal request
 * justifies the 15s CPU cap in wrangler.jsonc, billed per CPU-ms. Every hit
 * replaces that with a sub-millisecond cache read. The cache is per-colo and
 * evicts under pressure, so hits come from repeated identical queries near
 * each other - profile-less renders, crawlers, shared links - not from a
 * global memo. That's fine: this is a cost/latency valve, not a guarantee.
 *
 * Interplay with the middleware, which runs on hits and misses alike:
 * `rate-limit.ts` still counts every request against the caller's budget, and
 * the `site-flags-gate.ts` kill switch still 503s before this wrapper is
 * reached - a data incident is exactly when a cached-but-wrong answer must
 * not slip out.
 *
 * Fail-open by design, like `siteFlags.ts`: no `caches.default` (nuxt dev,
 * vitest, the prerender crawl), no build SHA, or a throwing cache all degrade
 * to computing the response as if this file didn't exist. Note the preview
 * env's PR Workers serve on workers.dev, where the Cache API is inert - so
 * previews exercise the same code path but every request is a miss; verify
 * hits on production via the `X-Recommend-Cache` header.
 */

/**
 * Freshness window for the stored copy (`Cache-Control: max-age`), i.e. how
 * long a *retired* build's entries linger at most; the running build's
 * entries can never be stale (see above). Seven days comfortably outlives a
 * colo's eviction pressure - the TTL is not doing correctness work.
 */
const CACHE_TTL_SEC = 7 * 24 * 60 * 60

/**
 * Minimal Cache API surface, hand-declared for the same reason as
 * `rate-limit.ts` and `siteFlags.ts`: `@cloudflare/workers-types`' ambient
 * globals would fight the Node types everywhere else. A string key is
 * interpreted by the runtime as the URL of a GET request.
 */
interface WorkersCache {
  match(key: string): Promise<{ text(): Promise<string> } | undefined>
  put(key: string, response: Response): Promise<void>
}

interface WorkersExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Canonical cache key for a request path. Two query strings that differ only
 * in parameter order are the same request, so the params are sorted
 * (`URLSearchParams.sort()` is stable: a repeated key keeps its values in
 * arrival order, which is the one ordering that could matter to parsing).
 * Unknown junk params fragment the key space but can't poison it - the query
 * schemas ignore them, so a fragment is only ever a wasted miss. The
 * synthetic host keeps these entries disjoint from any real URL on the zone,
 * and the build SHA is a path segment so every deploy gets a fresh namespace.
 */
export function recommendCacheKey(path: string, buildSha: string): string {
  const url = new URL(path, 'https://recommend-cache.internal')
  url.searchParams.sort()
  const query = url.searchParams.toString()
  return `https://recommend-cache.internal/${buildSha}${url.pathname}${query ? `?${query}` : ''}`
}

/**
 * `defineEventHandler` with the cache wrapped around it - the recommend
 * handlers swap one call for the other and stay otherwise ignorant of
 * caching. The stored body is `JSON.stringify(result)`, byte-identical to
 * what Nitro itself sends for the same object, and a hit is parsed back so
 * the handler's return type - which drives the client's `$fetch`/`useFetch`
 * typing - is preserved end to end.
 */
export function defineCachedRecommendHandler<T>(handler: (event: H3Event) => Promise<T>) {
  // A rider who cannot hold the route's grade at their power makes the
  // simulator throw `RouteSimulationStallError` for that combo. It is a fact
  // about the request (weight/power vs. this route), not a server fault, so
  // it is answered with a 422 the pages already surface through their
  // refetch notice - and, being thrown before `cache.put`, never cached.
  // Caught here rather than in each handler so the route and segment
  // endpoints cannot drift apart on it.
  const run = async (event: H3Event): Promise<T> => {
    try {
      return await handler(event)
    } catch (err) {
      if (err instanceof RouteSimulationStallError) {
        throw createError({ statusCode: 422, statusMessage: 'Rider cannot finish this route at this power', message: err.message })
      }
      throw err
    }
  }
  return defineEventHandler(async (event): Promise<T> => {
    const cache = (globalThis as { caches?: { default?: WorkersCache } }).caches?.default
    const buildSha = useRuntimeConfig(event).public.buildSha
    if (import.meta.prerender || !cache || !buildSha) return run(event)

    const key = recommendCacheKey(event.path, buildSha)
    try {
      const hit = await cache.match(key)
      if (hit) {
        setResponseHeader(event, 'X-Recommend-Cache', 'hit')
        addTimingMeta(event, { cached: true })
        return JSON.parse(await hit.text()) as T
      }
    } catch {
      // A failing cache read (or a corrupt entry) falls through to computing
      // the response - never to an error the caller can see.
    }

    const result = await run(event)
    setResponseHeader(event, 'X-Recommend-Cache', 'miss')
    const stored = new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL_SEC}`
      }
    })
    // Off the critical path via `waitUntil` where the platform context exists
    // (`.catch` first: an abandoned rejection would otherwise surface as an
    // unhandled error in Workers Logs). The awaited fallback only runs in
    // environments that reached here without one - effectively never.
    const put = cache.put(key, stored).catch(() => {})
    const ctx = (event.context.cloudflare as { context?: WorkersExecutionContext } | undefined)?.context
    if (ctx) ctx.waitUntil(put)
    else await put
    return result
  })
}
