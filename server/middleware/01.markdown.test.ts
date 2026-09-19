import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The middleware's own three jobs, which no other test covers: choosing a
 * representation, handing the HTML back to the asset binding rather than
 * re-rendering it, and falling through when the asset layer has nothing.
 *
 * The Nitro auto-imports it leans on resolve as bare globals at call time in
 * this plain-node suite (see vitest.config.ts), so `vi.stubGlobal` is all
 * the environment they need - the arrangement `recommendCache.test.ts`
 * documents. `defineEventHandler` is the exception: a middleware calls it
 * at import time, so it is stubbed to hand back the raw handler BEFORE the
 * module is imported, which is why the import below is dynamic.
 */
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)

interface TestEvent {
  path: string
  method: string
  headers: Record<string, string>
  context: Record<string, unknown>
  responseHeaders: Record<string, string>
}

vi.stubGlobal('getRequestHeader', (event: TestEvent, name: string) => event.headers[name])
// A host that is NOT the public site URL, standing in for a preview Worker.
vi.stubGlobal('getRequestURL', (event: TestEvent) => new URL(event.path, 'https://zwift-bikes-pr-1.workers.dev'))
vi.stubGlobal('setResponseHeaders', (event: TestEvent, headers: Record<string, string>) => {
  Object.assign(event.responseHeaders, headers)
})
vi.stubGlobal('appendResponseHeader', (event: TestEvent, name: string, value: string) => {
  event.responseHeaders[name] = event.responseHeaders[name] ? `${event.responseHeaders[name]}, ${value}` : value
})
// The public site URL, which is deliberately NOT the host under test - see
// the canonical assertions below.
vi.stubGlobal('useRuntimeConfig', () => ({ siteUrl: 'https://zwiftbikes.com' }))

// `as unknown` first: the stubbed `defineEventHandler` hands back the raw
// function, but its declared type is still h3's `EventHandler`, which a
// `TestEvent` deliberately does not implement - the handler only ever
// touches the four fields above.
const handler = (await import('./01.markdown')).default as unknown as (event: TestEvent) => Promise<unknown>

/** The assets binding, standing in for the prerendered file it would serve. */
function assetsReturning(response: Response) {
  const fetchSpy = vi.fn(async () => response)
  return { spy: fetchSpy, binding: { env: { ASSETS: { fetch: fetchSpy } }, request: new Request('https://zwiftbikes.com/segments') } }
}

function eventFor(path: string, accept: string | undefined, context: Record<string, unknown> = {}, method = 'GET'): TestEvent {
  return {
    path,
    method,
    headers: accept === undefined ? {} : { accept },
    context,
    responseHeaders: {}
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '$fetch')
  vi.clearAllMocks()
})

describe('a page the Worker never sees', () => {
  it('is left entirely alone', async () => {
    const { spy, binding } = assetsReturning(new Response('page', { status: 200 }))
    const event = eventFor('/about', 'text/markdown', { cloudflare: binding })

    // `/about` is not in run_worker_first, so in production this middleware
    // never runs for it at all - it must behave the same way when it does.
    expect(await handler(event)).toBeUndefined()
    expect(event.responseHeaders).toEqual({})
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('a page routed to the Worker that has no twin', () => {
  it('is handed back to the assets, and does not claim to vary', async () => {
    // `/events/*` must be a prefix rule to reach a race page, so it sweeps
    // in season pages too. Letting one fall into Nitro would re-render a
    // prerendered page on every request.
    const { spy, binding } = assetsReturning(new Response('<!doctype html>', { status: 200 }))
    const event = eventFor('/events/zrl-2026-27', 'text/markdown', { cloudflare: binding })

    const response = await handler(event) as Response
    expect(response.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    // No twin, so nothing varies - a Vary here would only fragment caches.
    expect(event.responseHeaders.Vary).toBeUndefined()
  })
})

describe('a request that did not ask for markdown', () => {
  it('is answered by the asset binding, not by re-rendering the page', async () => {
    const { spy, binding } = assetsReturning(new Response('<!doctype html>', { status: 200 }))
    const event = eventFor('/segments', 'text/html,*/*;q=0.8', { cloudflare: binding })

    const response = await handler(event) as Response
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<!doctype html>')
    expect(spy).toHaveBeenCalledTimes(1)
    // The HTML has to carry it too, or a shared cache holding one
    // representation serves it to callers who asked for the other.
    expect(event.responseHeaders.Vary).toBe('Accept')
  })

  it('falls through to Nitro when the asset layer has no such page', async () => {
    // `/routes/does-not-exist` was never prerendered. Returning the asset
    // layer's bare 404 would replace the styled Nuxt error page.
    const { binding } = assetsReturning(new Response('not found', { status: 404 }))
    const event = eventFor('/routes/does-not-exist', 'text/html', { cloudflare: binding })

    expect(await handler(event)).toBeUndefined()
  })

  it('falls through where there is no asset binding at all', async () => {
    // vitest, the prerender crawl and `nuxt dev` all land here.
    expect(await handler(eventFor('/segments', 'text/html'))).toBeUndefined()
  })
})

describe('a request that asked for markdown', () => {
  it('is answered in markdown, with the headers an agent reads', async () => {
    Reflect.set(globalThis, '$fetch', vi.fn(async () => ({ segments: [] })))
    const { spy, binding } = assetsReturning(new Response('<!doctype html>', { status: 200 }))
    const event = eventFor('/segments', 'text/markdown', { cloudflare: binding })

    const body = await handler(event) as string
    expect(body).toContain('# Zwift climbs and sprints')
    // The asset binding must not be consulted at all on this branch.
    expect(spy).not.toHaveBeenCalled()

    expect(event.responseHeaders['Content-Type']).toBe('text/markdown; charset=utf-8')
    expect(event.responseHeaders.Vary).toBe('Accept')
    expect(Number(event.responseHeaders['x-markdown-tokens'])).toBeGreaterThan(0)
    // The public site URL, never the preview host this request arrived on.
    expect(event.responseHeaders.Link).toBe('<https://zwiftbikes.com/segments>; rel="canonical"')
  })

  it('points the canonical link at the page, not at the query it arrived with', async () => {
    Reflect.set(globalThis, '$fetch', vi.fn(async () => ({ segments: [] })))
    const event = eventFor('/segments?world=watopia', 'text/markdown')

    await handler(event)
    expect(event.responseHeaders.Link).toBe('<https://zwiftbikes.com/segments>; rel="canonical"')
  })

  it('is ignored on a method that cannot read a page', async () => {
    const { spy, binding } = assetsReturning(new Response('', { status: 405 }))
    const event = eventFor('/segments', 'text/markdown', { cloudflare: binding }, 'POST')

    expect(await handler(event)).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
    expect(event.responseHeaders).toEqual({})
  })
})
