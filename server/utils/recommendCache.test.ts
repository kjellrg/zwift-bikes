import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineCachedRecommendHandler, recommendCacheKey } from './recommendCache'
import { getRequestTiming, startRequestTiming } from './timing'

/**
 * Two contracts under test. The key builder's: requests that must share a
 * response share a key, and anything that can change the response changes the
 * key. And the wrapper's miss-then-hit lifecycle - which matters to test here
 * precisely because it can't be rehearsed before production: the preview env
 * serves on workers.dev, where the Cache API is inert and every request
 * misses. The nitro auto-imports the wrapper leans on (`defineEventHandler`,
 * `useRuntimeConfig`, `setResponseHeader`) resolve as bare globals at call
 * time in this plain-node suite (see vitest.config.ts), so `vi.stubGlobal`
 * is all the environment they need.
 */

describe('recommendCacheKey', () => {
  it('is insensitive to query parameter order', () => {
    expect(recommendCacheKey('/api/recommend/watopia-flat-route?weightKg=75&powerW=240&heightCm=180', 'abc1234'))
      .toBe(recommendCacheKey('/api/recommend/watopia-flat-route?heightCm=180&powerW=240&weightKg=75', 'abc1234'))
  })

  it('keeps a repeated key\'s values in arrival order while sorting keys', () => {
    const key = recommendCacheKey('/api/recommend/x?b=2&a=first&a=second', 'abc1234')
    expect(key).toBe('https://recommend-cache.internal/abc1234/api/recommend/x?a=first&a=second&b=2')
  })

  it('separates builds, paths and queries', () => {
    const base = recommendCacheKey('/api/recommend/x?limit=9', 'abc1234')
    expect(recommendCacheKey('/api/recommend/x?limit=9', 'def5678')).not.toBe(base)
    expect(recommendCacheKey('/api/recommend/y?limit=9', 'abc1234')).not.toBe(base)
    expect(recommendCacheKey('/api/recommend/x?limit=18', 'abc1234')).not.toBe(base)
  })

  it('handles a query-less path', () => {
    expect(recommendCacheKey('/api/recommend/x', 'abc1234'))
      .toBe('https://recommend-cache.internal/abc1234/api/recommend/x')
  })
})

/**
 * In-memory stand-in for `caches.default`, faithful to the one behavior the
 * wrapper depends on: `put` consumes a `Response` body, `match` returns
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

function fakeEvent(path: string): H3Event {
  return { path, context: {} } as unknown as H3Event
}

const BUILD_SHA = 'abc1234'
const PAYLOAD = { combos: [{ score: 97 }], pagination: { offset: 0, limit: 9 } }

describe('defineCachedRecommendHandler', () => {
  const setResponseHeader = vi.fn()

  beforeEach(() => {
    setResponseHeader.mockClear()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { buildSha: BUILD_SHA } }))
    vi.stubGlobal('setResponseHeader', setResponseHeader)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('computes on a miss, stores the JSON copy, then serves the hit without the handler', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)
    const handler = vi.fn(async () => PAYLOAD)
    const wrapped = defineCachedRecommendHandler(handler) as unknown as (event: H3Event) => Promise<typeof PAYLOAD>

    const miss = await wrapped(fakeEvent('/api/recommend/x?limit=9&offset=0'))
    expect(miss).toBe(PAYLOAD)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(setResponseHeader).toHaveBeenLastCalledWith(expect.anything(), 'X-Recommend-Cache', 'miss')
    const entry = store.get(recommendCacheKey('/api/recommend/x?limit=9&offset=0', BUILD_SHA))
    expect(entry?.body).toBe(JSON.stringify(PAYLOAD))
    expect(entry?.headers['content-type']).toBe('application/json')
    expect(entry?.headers['cache-control']).toMatch(/^public, max-age=\d+$/)

    // Param order differs - the canonical key must make it the same request.
    const hitEvent = fakeEvent('/api/recommend/x?offset=0&limit=9')
    startRequestTiming(hitEvent)
    const hit = await wrapped(hitEvent)
    expect(hit).toEqual(PAYLOAD)
    expect(hit).not.toBe(PAYLOAD)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(setResponseHeader).toHaveBeenLastCalledWith(expect.anything(), 'X-Recommend-Cache', 'hit')
    expect(getRequestTiming(hitEvent)?.meta.cached).toBe(true)
  })

  it('bypasses the cache without caches.default or a build SHA', async () => {
    const handler = vi.fn(async () => PAYLOAD)
    const wrapped = defineCachedRecommendHandler(handler) as unknown as (event: H3Event) => Promise<typeof PAYLOAD>

    // No `caches` global at all (nuxt dev, this suite).
    await wrapped(fakeEvent('/api/recommend/x'))
    expect(handler).toHaveBeenCalledTimes(1)

    // Cache present but no SHA (a build without BUILD_SHA/GITHUB_SHA): still
    // compute-only, and nothing may be stored under an un-namespaced key.
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { buildSha: '' } }))
    await wrapped(fakeEvent('/api/recommend/x'))
    expect(handler).toHaveBeenCalledTimes(2)
    expect(store.size).toBe(0)
    expect(setResponseHeader).not.toHaveBeenCalled()
  })

  it('degrades a throwing cache to a plain compute', async () => {
    const down = async (): Promise<never> => {
      throw new Error('cache down')
    }
    vi.stubGlobal('caches', { default: { match: down, put: down } })
    const handler = vi.fn(async () => PAYLOAD)
    const wrapped = defineCachedRecommendHandler(handler) as unknown as (event: H3Event) => Promise<typeof PAYLOAD>

    await expect(wrapped(fakeEvent('/api/recommend/x'))).resolves.toBe(PAYLOAD)
    await expect(wrapped(fakeEvent('/api/recommend/x'))).resolves.toBe(PAYLOAD)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('never caches a handler error', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)
    const handler = vi.fn(async (): Promise<never> => {
      throw new Error('404-ish')
    })
    const wrapped = defineCachedRecommendHandler(handler) as unknown as (event: H3Event) => Promise<unknown>

    await expect(wrapped(fakeEvent('/api/recommend/nope'))).rejects.toThrow('404-ish')
    expect(store.size).toBe(0)
    await expect(wrapped(fakeEvent('/api/recommend/nope'))).rejects.toThrow('404-ish')
    expect(handler).toHaveBeenCalledTimes(2)
  })
})
