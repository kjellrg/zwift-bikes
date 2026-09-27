import type { H3Event } from 'h3'
import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The recommend endpoints as the HTTP adapter of the Ride ranking module:
 * the same 400, 404, 422 and 503 as before the module existed, and the
 * cache header. The real handler files are run, with only the nitro
 * auto-imports they lean on stood in for (see vitest.config.ts) - the same
 * arrangement as `recommendCache.test.ts`.
 */

let routerSlug = ''
const setResponseHeader = vi.fn()

beforeEach(() => {
  setResponseHeader.mockClear()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRouterParam', () => routerSlug)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('setResponseHeader', setResponseHeader)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Handler = (event: H3Event) => Promise<{ combos: unknown[] }>
const routeHandler = async () => (await import('../api/recommend/[slug].get')).default as unknown as Handler
const segmentHandler = async () => (await import('../api/recommend/segments/[slug].get')).default as unknown as Handler

function eventFor(path: string, context: Record<string, unknown> = {}): H3Event {
  return { path, context } as unknown as H3Event
}

async function statusOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    const { statusCode, statusMessage, message } = error as { statusCode: number, statusMessage: string, message: string }
    return { statusCode, statusMessage, message }
  }
  throw new Error('expected the handler to throw')
}

describe('the recommend endpoints', () => {
  it('404s an unknown route or segment', async () => {
    routerSlug = 'no-such-route'
    expect(await statusOf((await routeHandler())(eventFor('/api/recommend/no-such-route'))))
      .toMatchObject({ statusCode: 404, statusMessage: 'Route "no-such-route" not found' })
    routerSlug = 'no-such-segment'
    expect(await statusOf((await segmentHandler())(eventFor('/api/recommend/segments/no-such-segment'))))
      .toMatchObject({ statusCode: 404, statusMessage: 'Segment "no-such-segment" not found' })
  })

  it('400s an out-of-range parameter, naming it', async () => {
    routerSlug = 'tempus-fugit'
    const error = await statusOf((await routeHandler())(eventFor('/api/recommend/tempus-fugit?limit=50')))
    expect(error).toMatchObject({ statusCode: 400, statusMessage: 'Invalid query parameters' })
    expect(error.message).toContain('limit')
  })

  it('422s a rider who cannot hold the grade, in the simulator\'s words', async () => {
    routerSlug = 'road-to-sky'
    expect(await statusOf((await routeHandler())(eventFor('/api/recommend/road-to-sky?weightKg=200&heightCm=220&powerW=9'))))
      .toMatchObject({ statusCode: 422, statusMessage: 'Rider cannot finish this route at this power', message: expect.stringMatching(/^Rider \(200 kg, 9 W\) stalled/) })
  })

  it('answers with the ranking and says whether the cache had it', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { buildSha: 'abc1234' } }))
    const store = new Map<string, string>()
    vi.stubGlobal('caches', {
      default: {
        match: async (key: string) => (store.has(key) ? { text: async () => store.get(key)! } : undefined),
        put: async (key: string, response: Response) => void store.set(key, await response.text())
      }
    })
    routerSlug = 'alley-sprint'
    const handler = await segmentHandler()

    const miss = await handler(eventFor('/api/recommend/segments/alley-sprint?limit=2&category=standard'))
    expect(miss.combos).toHaveLength(2)
    expect(setResponseHeader).toHaveBeenLastCalledWith(expect.anything(), 'X-Recommend-Cache', 'miss')
    const hit = await handler(eventFor('/api/recommend/segments/alley-sprint?category=standard&limit=2'))
    expect(hit).toEqual(miss)
    expect(setResponseHeader).toHaveBeenLastCalledWith(expect.anything(), 'X-Recommend-Cache', 'hit')
  })

  // Last: `getSiteFlags` memoises a KV read for a minute, module-wide.
  it('503s with Retry-After while the recommend kill switch is on', async () => {
    routerSlug = 'tempus-fugit'
    const kv = { get: async () => JSON.stringify({ killSwitches: { recommend: true } }) }
    const error = await statusOf((await routeHandler())(eventFor('/api/recommend/tempus-fugit', { cloudflare: { env: { SITE_FLAGS: kv } } })))
    expect(error).toMatchObject({ statusCode: 503, statusMessage: 'Service Unavailable', message: 'Recommendations are temporarily paused for maintenance.' })
    expect(setResponseHeader).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 300)
  })
})
