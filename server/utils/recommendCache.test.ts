import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recommendCacheFor, recommendCacheKey } from './recommendCache'

/**
 * The storage half of the ranking cache - what is cached and under which
 * normalised input is `rankRide.test.ts`'s to cover. What matters here can't
 * be rehearsed before production (the preview env serves on workers.dev,
 * where the Cache API is inert): an entry round-trips, the build namespaces
 * it, and every failure degrades to "no cache" rather than to an error. The
 * nitro auto-import this leans on (`useRuntimeConfig`) resolves as a bare
 * global at call time in this plain-node suite (see vitest.config.ts), so
 * `vi.stubGlobal` is all the environment it needs.
 */

describe('recommendCacheKey', () => {
  it('separates builds, courses and inputs', () => {
    const base = recommendCacheKey('abc1234', 'route/x', '{"a":1}')
    expect(recommendCacheKey('def5678', 'route/x', '{"a":1}')).not.toBe(base)
    expect(recommendCacheKey('abc1234', 'segment/x', '{"a":1}')).not.toBe(base)
    expect(recommendCacheKey('abc1234', 'route/x', '{"a":2}')).not.toBe(base)
  })

  it('is a URL on the synthetic host, namespaced by the build', () => {
    const key = new URL(recommendCacheKey('abc1234', 'route/tempus-fugit', '{"laps":1}'))
    expect(key.host).toBe('recommend-cache.internal')
    expect(key.pathname).toBe('/abc1234/route/tempus-fugit')
    expect(key.searchParams.get('input')).toBe('{"laps":1}')
  })
})

/**
 * In-memory stand-in for `caches.default`, faithful to the one behavior the
 * storage depends on: `put` consumes a `Response` body, `match` returns
 * something exposing that body via `text()`, both keyed by exact URL string.
 */
function fakeCaches() {
  const store = new Map<string, { body: string, headers: Record<string, string> }>()
  return {
    store,
    caches: {
      default: {
        async match(key: string) {
          const entry = store.get(key)
          return entry && { text: async () => entry.body }
        },
        async put(key: string, response: Response) {
          store.set(key, {
            body: await response.text(),
            headers: Object.fromEntries(response.headers.entries())
          })
        }
      }
    }
  }
}

const BUILD_SHA = 'abc1234'

describe('recommendCacheFor', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { buildSha: BUILD_SHA } }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips an entry as JSON with a long public max-age', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)
    const cache = recommendCacheFor()!
    expect(cache.buildSha).toBe(BUILD_SHA)

    expect(await cache.read('https://recommend-cache.internal/k')).toBeUndefined()
    await cache.write('https://recommend-cache.internal/k', '{"combos":[]}')
    expect(await cache.read('https://recommend-cache.internal/k')).toBe('{"combos":[]}')
    const entry = store.get('https://recommend-cache.internal/k')
    expect(entry?.headers['content-type']).toBe('application/json')
    expect(entry?.headers['cache-control']).toMatch(/^public, max-age=\d+$/)
  })

  it('hands the write to the request\'s waitUntil where the platform gives one', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)
    const pending: Promise<unknown>[] = []
    const event = { context: { cloudflare: { context: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } } } } as unknown as H3Event

    await recommendCacheFor(event)!.write('https://recommend-cache.internal/k', '{}')
    expect(pending).toHaveLength(1)
    await Promise.all(pending)
    expect(store.has('https://recommend-cache.internal/k')).toBe(true)
  })

  it('is absent without caches.default or a build SHA', () => {
    // No `caches` global at all (nuxt dev, this suite).
    expect(recommendCacheFor()).toBeUndefined()

    // Cache present but no SHA (a build without BUILD_SHA/GITHUB_SHA):
    // nothing may be stored under an un-namespaced key.
    vi.stubGlobal('caches', fakeCaches().caches)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { buildSha: '' } }))
    expect(recommendCacheFor()).toBeUndefined()
  })

  it('degrades a throwing cache to misses and silent writes', async () => {
    const down = async (): Promise<never> => {
      throw new Error('cache down')
    }
    vi.stubGlobal('caches', { default: { match: down, put: down } })
    const cache = recommendCacheFor()!

    await expect(cache.read('https://recommend-cache.internal/k')).resolves.toBeUndefined()
    await expect(cache.write('https://recommend-cache.internal/k', '{}')).resolves.toBeUndefined()
  })
})
