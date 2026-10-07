import { describe, expect, it, vi } from 'vitest'

/**
 * What this middleware promises: a page URL is answered with the HTML error
 * page whatever it was asked for, and that page can mark itself noindex.
 * Nitro and Nuxt decide the rest - the status, the render - so the test
 * pins only the two things this file changes on the event: the `Accept`
 * header Nitro's error handler reads, and the robots context the error
 * page's `useRobotsRule` writes into.
 *
 * Stubbed the way `02.markdown.test.ts` documents: `defineEventHandler` hands
 * back the raw handler before the dynamic import, and the h3 helper the
 * middleware calls reads the same plain object the handler mutates.
 */
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRequestHeader', (event: TestEvent, name: string) => event.node.req.headers[name])
vi.stubGlobal('useRuntimeConfig', () => ({
  public: { 'nuxt-robots': { robotsDisabledValue: 'noindex, nofollow' } }
}))

interface TestEvent {
  path: string
  node: { req: { headers: Record<string, string | undefined> } }
  context: Record<string, unknown>
}

const handler = (await import('./03.page-errors')).default as unknown as (event: TestEvent) => unknown

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

function eventFor(path: string, accept?: string, context: Record<string, unknown> = {}): TestEvent {
  return {
    path,
    node: { req: { headers: accept === undefined ? {} : { accept } } },
    context
  }
}

/** The `Accept` the rest of the request - and Nitro's error handler - will see. */
function acceptAfter(path: string, accept?: string): string | undefined {
  const event = eventFor(path, accept)
  handler(event)
  return event.node.req.headers.accept
}

describe('a page URL', () => {
  // One of each kind of page a wrong link lands on (issue #269).
  const PAGES = [
    '/routes/no-such-route',
    '/segments/no-such-segment',
    '/events/zrl-2026-27/no-such-race',
    '/xyz'
  ]

  it.each(PAGES)('%s asks for HTML whatever the caller sent', (path) => {
    // curl's default, an agent's `application/json`, and no header at all:
    // each one is what makes Nitro answer a page's error in JSON today.
    expect(acceptAfter(path, '*/*')).toBe('text/html')
    expect(acceptAfter(path, 'application/json')).toBe('text/html')
    expect(acceptAfter(path, undefined)).toBe('text/html')
    expect(acceptAfter(path, BROWSER)).toBe('text/html')
  })

  it('keeps its query string out of the decision', () => {
    expect(acceptAfter('/routes/no-such-route?ref=share', '*/*')).toBe('text/html')
  })

  it('that asked for markdown is left to the markdown twin', () => {
    // `02.markdown.ts` answers it, and its own errors stay JSON.
    expect(acceptAfter('/routes/no-such-route', 'text/markdown')).toBe('text/markdown')
  })
})

describe('a URL that is not a page', () => {
  it.each([
    '/api/routes/no-such-route',
    '/api',
    '/_nuxt/entry.js',
    '/__og-image__/static/og.png',
    '/routes/watopia-flat-route/_payload.json',
    '/favicon.ico'
  ])('%s keeps the Accept it came with', (path) => {
    expect(acceptAfter(path, '*/*')).toBe('*/*')
    expect(acceptAfter(path, undefined)).toBeUndefined()
  })
})

/**
 * Nuxt renders the error page in a second, internal request to
 * `/__nuxt_error`, and the robots module's context middleware skips every
 * `/__` path. Without a context there, `useRobotsRule` in `error.vue` throws
 * on its first write, which is what emptied the server-rendered body and lost
 * the noindex.
 */
describe('the error page render', () => {
  it.each([404, 500])('has a robots context to write into, for a %i', (status) => {
    const event = eventFor(`/__nuxt_error?statusCode=${status}`, 'text/html')
    handler(event)
    expect(event.context.robots).toEqual({ indexable: false, rule: 'noindex, nofollow' })
  })

  it('keeps a context the robots module did set', () => {
    const robots = { indexable: true, rule: 'index, follow' }
    const event = eventFor('/__nuxt_error?statusCode=404', 'text/html', { robots })
    handler(event)
    expect(event.context.robots).toBe(robots)
  })

  it('is left the Accept it was rendered with', () => {
    expect(acceptAfter('/__nuxt_error?statusCode=404', BROWSER)).toBe(BROWSER)
  })
})
