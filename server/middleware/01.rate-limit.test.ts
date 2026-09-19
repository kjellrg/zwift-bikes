import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * What this middleware has to get right that no other test covers: which
 * requests cost enough to meter. The binding, the key and the 429 are one
 * short path; the interesting part is that a page URL is metered on its
 * `Accept` header rather than its path, because the HTML at that same URL
 * is free prerendered bytes.
 *
 * Same arrangement as `02.markdown.test.ts`: Nitro's auto-imports resolve as
 * bare globals at call time in this plain-node suite, and
 * `defineEventHandler` is stubbed BEFORE the import because a middleware
 * calls it at import time - hence the dynamic import.
 */
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)

interface TestEvent {
  path: string
  context: Record<string, unknown>
  headers: Record<string, string>
  responseHeaders: Record<string, string | number>
}

vi.stubGlobal('getRequestHeader', (event: TestEvent, name: string) => event.headers[name])
vi.stubGlobal('setResponseHeader', (event: TestEvent, name: string, value: string | number) => {
  event.responseHeaders[name] = value
})
vi.stubGlobal('createError', (init: { statusCode: number, message: string }) =>
  Object.assign(new Error(init.message), init))

const handler = (await import('./01.rate-limit')).default as unknown as (event: TestEvent) => Promise<unknown>

const CLIENT_IP = '203.0.113.7'

/** The Workers binding, with the verdict it should hand back. */
function limiterReturning(success: boolean) {
  const limit = vi.fn(async () => ({ success }))
  return { limit, context: { cloudflare: { env: { RECOMMEND_RATE_LIMITER: { limit } } } } }
}

function eventFor(path: string, accept: string | undefined, context: Record<string, unknown>): TestEvent {
  return {
    path,
    context,
    headers: { 'cf-connecting-ip': CLIENT_IP, ...(accept === undefined ? {} : { accept }) },
    responseHeaders: {}
  }
}

afterEach(() => vi.clearAllMocks())

describe('a markdown page request', () => {
  it('costs a count, keyed on the edge-set client IP', async () => {
    const { limit, context } = limiterReturning(true)

    await handler(eventFor('/routes/hilly-route', 'text/markdown', context))
    expect(limit).toHaveBeenCalledWith({ key: CLIENT_IP })
  })

  it('is metered on every shape of document, including a race', async () => {
    const { limit, context } = limiterReturning(true)

    await handler(eventFor('/events/zrl-2026-27/round-1-week-1', 'text/markdown', context))
    await handler(eventFor('/segments/alpe-du-zwift', 'text/markdown', context))
    await handler(eventFor('/segments', 'text/markdown', context))
    expect(limit).toHaveBeenCalledTimes(3)
  })

  it('is refused with a Retry-After once the window is spent', async () => {
    const { context } = limiterReturning(false)
    const event = eventFor('/routes/hilly-route', 'text/markdown', context)

    await expect(handler(event)).rejects.toMatchObject({ statusCode: 429 })
    expect(event.responseHeaders['Retry-After']).toBe(60)
  })
})

describe('a request for the same page as HTML', () => {
  it('costs nothing, because the asset layer answers it for free', async () => {
    const { limit, context } = limiterReturning(true)

    await handler(eventFor('/routes/hilly-route', 'text/html,application/xhtml+xml,*/*;q=0.8', context))
    await handler(eventFor('/routes/hilly-route', undefined, context))
    expect(limit).not.toHaveBeenCalled()
  })
})

describe('a path routed to the Worker that has no document', () => {
  it('costs nothing even when it asks for markdown', async () => {
    // A season page is swept in by the `/events/*` rule and handed straight
    // back to the assets, so there is no pipeline run to pay for.
    const { limit, context } = limiterReturning(true)

    await handler(eventFor('/events/zrl-2026-27', 'text/markdown', context))
    expect(limit).not.toHaveBeenCalled()
  })
})

describe('the recommend API', () => {
  it('still costs a count', async () => {
    const { limit, context } = limiterReturning(true)

    await handler(eventFor('/api/recommend/hilly-route?weightKg=75', undefined, context))
    expect(limit).toHaveBeenCalledTimes(1)
  })

  it('does not meter /api/mcp, which the edge gates instead', async () => {
    // Access is enforced at the Cloudflare zone, so a caller that reaches
    // the Worker is already a known party. If that gate ever goes, this
    // expectation is the thing that should start failing.
    const { limit, context } = limiterReturning(true)

    await handler(eventFor('/api/mcp', undefined, context))
    expect(limit).not.toHaveBeenCalled()
  })

  it('are exempt when the platform context is absent', async () => {
    // Nitro's in-process `$fetch` - the SSR renders, the prerender crawl,
    // and the recommend call a markdown document makes - lands here. One
    // external request must cost one count, not one per internal fetch.
    const event = eventFor('/api/recommend/hilly-route', undefined, {})
    await expect(handler(event)).resolves.toBeUndefined()
  })
})
