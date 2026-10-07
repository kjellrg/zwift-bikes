import { expect, test, type APIResponse, type Page } from '@playwright/test'

/**
 * A wrong URL answers with a 404 page that a crawler, an agent and a reader
 * without JavaScript can all read, and that keeps itself out of the index
 * (issue #269). `server/middleware/03.page-errors.ts` makes a page URL ask
 * for HTML whoever sent it and gives the error render the robots context it
 * needs; its choices, including a 500 getting the same page, are unit-tested
 * in `03.page-errors.test.ts`. This spec checks the served result.
 *
 * Nitro answers an error in JSON when the request's `Accept` lacks
 * `text/html` AND it looks like a script: `application/json`, or curl's own
 * user agent. Playwright's request context sends a wildcard under its own
 * agent, which Nitro already answered in HTML, so each caller here sends the
 * headers the real one does.
 */

/** One wrong URL of each kind a rider can land on. */
const WRONG_URLS = [
  { kind: 'route', path: '/routes/no-such-route' },
  { kind: 'segment', path: '/segments/no-such-segment' },
  { kind: 'race', path: '/events/zrl-2026-27/no-such-race' },
  { kind: 'top-level path', path: '/xyz' }
]

interface Caller { name: string, headers: Record<string, string> }

const CURL = 'curl/8.5.0'
const BROWSER: Caller = { name: 'a browser', headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } }
const CURL_DEFAULT: Caller = { name: 'curl\'s default */*', headers: { 'accept': '*/*', 'user-agent': CURL } }
// An empty value is how a request context sends "no Accept": Playwright
// adds its own `*/*` to a header left out.
const NO_ACCEPT: Caller = { name: 'no Accept header', headers: { 'accept': '', 'user-agent': CURL } }
const JSON_AGENT: Caller = { name: 'an agent asking for JSON', headers: { accept: 'application/json' } }

/** The callers the ticket names, with the headers each really sends. */
const CALLERS = [BROWSER, CURL_DEFAULT, NO_ACCEPT, JSON_AGENT]

/** What a crawler reads off the served body. */
async function served(page: Page, source: string) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'text/html')
    const main = doc.querySelector('main')
    return {
      robots: [...doc.querySelectorAll('meta[name="robots"]')].map(meta => meta.getAttribute('content')),
      heading: main?.querySelector('h1')?.textContent?.trim(),
      text: main?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      links: [...main?.querySelectorAll('a') ?? []].map(link => ({ text: link.textContent?.trim(), href: link.getAttribute('href') }))
    }
  }, source)
}

/** Every `X-Robots-Tag` the response carries - there must be exactly one. */
function robotsHeaders(response: APIResponse): string[] {
  return response.headersArray().filter(header => header.name.toLowerCase() === 'x-robots-tag').map(header => header.value)
}

const EXPLANATION = 'There is nothing at this address.'
const ONWARD_LINKS = [
  { text: 'Browse routes', href: '/' },
  { text: 'Segments', href: '/segments' },
  { text: 'Events', href: '/events' }
]

test.describe('a wrong URL', () => {
  for (const { kind, path } of WRONG_URLS) {
    for (const caller of CALLERS) {
      test(`for a ${kind}, asked by ${caller.name}, is the not-found page, noindex`, async ({ page, request }) => {
        const response = await request.get(path, { headers: caller.headers })
        expect(response.status()).toBe(404)
        expect(response.headers()['content-type']).toContain('text/html')
        // `follow`: its links are where a rider should go next.
        expect(robotsHeaders(response)).toEqual(['noindex, follow'])

        const body = await served(page, await response.text())
        expect(body.robots).toEqual(['noindex, follow'])
        expect(body.heading).toMatch(/not found/)
        expect(body.text).toContain(EXPLANATION)
        expect(body.links).toEqual(ONWARD_LINKS)
      })
    }
  }
})

test.describe('a wrong URL without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('still reads, and still points onwards', async ({ page }) => {
    const response = await page.goto('/routes/no-such-route')
    expect(response?.status()).toBe(404)

    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Route not found')
    await expect(main).toContainText(EXPLANATION)
    for (const link of ONWARD_LINKS) {
      await expect(main.getByRole('link', { name: link.text })).toHaveAttribute('href', link.href)
    }
  })
})

test.describe('what is not a page', () => {
  test('a wrong API URL stays a JSON error', async ({ request }) => {
    for (const { headers } of [CURL_DEFAULT, JSON_AGENT]) {
      const response = await request.get('/api/routes/no-such-route', { headers })
      expect(response.status()).toBe(404)
      expect(response.headers()['content-type']).toContain('application/json')
      expect((await response.json()).statusCode).toBe(404)
    }
  })

  test('the markdown of a wrong page stays a JSON error', async ({ request }) => {
    // Left exactly as it was: `02.markdown.ts` throws the twin's 404 before
    // the page-error middleware runs, and Nitro picks JSON for it by the
    // agent's user agent, as before - a browser's agent asking for markdown
    // would get the HTML page, which is noindex all the same.
    const response = await request.get('/routes/no-such-route', { headers: { ...CURL_DEFAULT.headers, accept: 'text/markdown' } })
    expect(response.status()).toBe(404)
    expect(response.headers()['content-type']).toContain('application/json')
    expect((await response.json()).statusCode).toBe(404)
  })
})
