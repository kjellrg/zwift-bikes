import { expect, type Locator, type Page, type Response } from '@playwright/test'

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
/** That other question: one frame's wheels, which the disclosure and the drawer both ask. */
export const isDrillDownUrl = (url: string) => url.includes('/api/recommend/') && url.includes('wheelsForFrame')

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

/**
 * A client-side navigation with an Overlay open - the page changing under an
 * Overlay that stays up. No rider gesture reaches this since #239: an open
 * Overlay covers every link on the page, and the back gesture now closes the
 * Overlay rather than navigating. So the journeys that need the ordering (the
 * back stack in `overlay-dismissal.spec.ts`, the barred-frame attribution in
 * `race-recommendation.spec.ts` and `segment-recommendation.spec.ts`) ask the
 * app's own router for what a link would have done. Shared for the same reason
 * the waits are: a second hand-rolled reach into the router would be a second
 * chance to get it subtly wrong.
 */
export async function navigateUnderOverlay(page: Page, to: string) {
  await page.evaluate(async (to) => {
    const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { $nuxt: { $router: { push: (to: string) => Promise<unknown> } } } }).__vue_app__
    await app.$nuxt.$router.push(to)
  }, to)
  // The path, not the whole URL: a ranking page writes its own Shared view
  // into the query on mount, so a target carrying one (`?rules=points`) comes
  // back with the keys in the page's order, not the caller's. Where the rider
  // landed is what this helper is for.
  await expect.poll(() => new URL(page.url()).pathname).toBe(to.split('?')[0])
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

/**
 * A colour as the browser resolves it, so a design token can be compared with
 * a computed style. Shared because three specs check the same theme grounds
 * and a fourth answer to "what is `--ui-bg` here" would be a fourth chance to
 * get it subtly wrong.
 */
export async function resolvedColor(page: Page, cssColor: string) {
  return page.evaluate((cssColor) => {
    const probe = document.createElement('div')
    probe.style.color = cssColor
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, cssColor)
}

/**
 * Tabs forward until `target` has focus, so a journey can assert reachability
 * and order without counting the tab stops of every control between them - a
 * count a new filter would silently invalidate. Shared because both discovery
 * pages walk the same path from the skip link to their first card.
 */
export async function tabTo(page: Page, target: Locator, limit = 25) {
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate(element => element === document.activeElement)) return
  }
  throw new Error(`focus never reached ${target} within ${limit} tabs`)
}

/**
 * A real pointer drag on a slider thumb: press, move across steps, release.
 * Reka's slider moves the value on every pointer move and commits (`change`)
 * on the release, which is the contract the rider-settings and profile
 * journeys check - so no keyboard shortcuts and no `fill`. `during` runs
 * after each move, while the pointer is still down.
 */
export async function dragThumb(page: Page, thumb: Locator, dx: number, during?: () => Promise<void>) {
  const box = await thumb.boundingBox()
  expect(box).toBeTruthy()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  const steps = 4
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(x + (dx * step) / steps, y)
    await during?.()
  }
  await page.mouse.up()
}

export async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
}
