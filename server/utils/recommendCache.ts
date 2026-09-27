import type { H3Event } from 'h3'

/**
 * The storage behind the Ride ranking module's cache (`rankRide.ts`), backed
 * by the Workers Cache API (`caches.default` - free, no binding to declare in
 * wrangler.jsonc). What is cached, and under which key, is the module's
 * business; this file only knows how to read and write one entry.
 *
 * A ranking is a pure function of its normalised input + the data baked into
 * the deployed bundle: no clock, no KV, no per-request state reaches the
 * output. So a ranking computed once is correct until the next deploy - and
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
 * Interplay with the kill switch and the middleware: `rankRide` checks
 * `killSwitches.recommend` before it reads the cache, so a data incident -
 * exactly when a cached-but-wrong answer must not slip out - stops hits too,
 * for in-process callers as well as HTTP ones. Over HTTP the
 * `site-flags-gate.ts` middleware 503s even earlier, and `01.rate-limit.ts`
 * still counts every request, hit or miss, against the caller's budget.
 *
 * Fail-open by design, like `siteFlags.ts`: no `caches.default` (nuxt dev,
 * vitest, the prerender crawl), no build SHA, or a throwing cache all degrade
 * to computing the ranking as if this file didn't exist. Note the preview
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
 * `01.rate-limit.ts` and `siteFlags.ts`: `@cloudflare/workers-types`' ambient
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

/** One build's view of the cache: what a caller needs to read and write entries. */
export interface RecommendCache {
  /** The build's commit, which every key is namespaced by. */
  buildSha: string
  /** The stored body, or `undefined` on a miss or a failing read. */
  read(key: string): Promise<string | undefined>
  /** Stores `body` (JSON) under `key`; never throws. */
  write(key: string, body: string): Promise<void>
}

/**
 * The cache, or `undefined` when there is none to use (see the module
 * comment). `event` is the request the ranking answers, if any - only its
 * platform context is read, to take the write off the critical path.
 */
export function recommendCacheFor(event?: H3Event): RecommendCache | undefined {
  // The cache is looked for first: without one (nuxt dev, vitest, the parity
  // script) the runtime config is never touched, so an in-process caller in
  // a plain-node test needs no Nitro stub at all.
  const cache = (globalThis as { caches?: { default?: WorkersCache } }).caches?.default
  if (import.meta.prerender || !cache) return undefined
  const buildSha = useRuntimeConfig(event).public.buildSha
  if (!buildSha) return undefined

  return {
    buildSha,
    async read(key) {
      try {
        const hit = await cache.match(key)
        return hit ? await hit.text() : undefined
      } catch {
        // A failing cache read (or a corrupt entry) falls through to computing
        // the ranking - never to an error the caller can see.
        return undefined
      }
    },
    async write(key, body) {
      // The stored body is `JSON.stringify(ranking)`, byte-identical to what
      // Nitro itself sends for the same object.
      const stored = new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${CACHE_TTL_SEC}`
        }
      })
      // Off the critical path via `waitUntil` where the platform context exists
      // (`.catch` first: an abandoned rejection would otherwise surface as an
      // unhandled error in Workers Logs). The awaited fallback runs wherever
      // there is no request context to hand it to - an in-process caller that
      // passed no event.
      const put = cache.put(key, stored).catch(() => {})
      const ctx = (event?.context.cloudflare as { context?: WorkersExecutionContext } | undefined)?.context
      if (ctx) ctx.waitUntil(put)
      else await put
    }
  }
}

/**
 * The cache key for one ranking. `path` names the Ride's course
 * (`route/<slug>`, `segment/<slug>`) and `input` is the rest of the question,
 * already normalised by the caller into one canonical string - so two callers
 * that ask the same thing in a different parameter order or spelling share
 * an entry. The synthetic host keeps these entries disjoint from any real URL
 * on the zone, and the build SHA is a path segment so every deploy gets a
 * fresh namespace.
 */
export function recommendCacheKey(buildSha: string, path: string, input: string): string {
  const url = new URL(`https://recommend-cache.internal/${buildSha}/${path}`)
  url.searchParams.set('input', input)
  return url.toString()
}
