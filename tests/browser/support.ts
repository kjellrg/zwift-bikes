import { expect, type Page, type Response } from '@playwright/test'

/**
 * The waits every ranking-page journey needs, in one place. They are waits for
 * real signals - hydration, a recommend response, the results region leaving
 * its busy state - never sleeps, because a cold dev-server request takes ~20 s
 * and a warm one ~5 s, and no sleep is both fast enough and safe enough for
 * that spread.
 *
 * The waits and one seeding helper live here. Locators stay in the spec that
 * uses them: they are cheap, page-specific, and wanted in front of you when a
 * selector breaks.
 */

/** The listing body the ranking pages read - the fields a journey asserts on, not the whole response. */
export interface ListingBody {
  combos: { frame: { name: string }, wheelset?: { name: string }, finishTimeSec?: number }[]
  pagination?: { offset: number, returned: number, hasMore: boolean }
}

/** A recommend listing request's URL - the drill-down behind the wheel list is a different question. */
export const isListingUrl = (url: string) => url.includes('/api/recommend/') && !url.includes('wheelsForFrame')
export const isListingResponse = (response: Response) => isListingUrl(response.url())

/**
 * Seeds the rider profile (`useRiderProfile`'s `zwift-bikes:rider-profile`)
 * before the page's own `onMounted` reads it. The whole object is written, so
 * a second seed in the same test replaces the first rather than merging.
 */
export async function seedRiderProfile(page: Page, profile: Record<string, unknown>) {
  await page.addInitScript((profile) => {
    localStorage.setItem('zwift-bikes:rider-profile', JSON.stringify(profile))
  }, profile)
}

/** Resolves once the page has hydrated - the earliest point a click reaches a handler. */
export async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__?: { $nuxt?: { isHydrating?: boolean } } } | null)?.__vue_app__
    return app?.$nuxt?.isHydrating === false
  })
}

/** Resolves once the page has hydrated and its results are no longer busy. */
export async function ready(page: Page) {
  await hydrated(page)
  await expect(page.locator('#ride-results')).toHaveAttribute('aria-busy', 'false')
}

/** Opens a ranking page (route, segment, race) and waits for its results. */
export async function visit(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect(response?.ok(), `${path} answered ${response?.status()}`).toBe(true)
  await ready(page)
}

/** Opens a page with no ranking on it (a hub, the events calendar, the profile page), where `visit`'s results wait has nothing to wait on. */
export async function visitPage(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect(response?.ok(), `${path} answered ${response?.status()}`).toBe(true)
  await hydrated(page)
}

/** Runs `action`, waits for the listing response it triggers and for the page to apply it, and hands back the request and the body. */
export async function rerank(page: Page, action: () => Promise<void>) {
  const responsePromise = page.waitForResponse(isListingResponse)
  await action()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  await ready(page)
  return {
    query: new URL(response.url()).searchParams,
    data: await response.json() as ListingBody
  }
}

export async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
}
