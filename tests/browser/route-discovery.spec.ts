import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, ready, resolvedColor, visitPage } from './support'

/**
 * Route discovery (issue #210): the homepage as the way into a
 * recommendation. Journeys assert what a rider gets - a filtered list, a
 * route page with a real time on it, the same filtered list on the way back -
 * and what a crawler gets, which is real hrefs in the server's HTML rather
 * than a grid that only exists after hydration.
 *
 * Both projects run: the filter row wraps on a phone rather than collapsing
 * into a disclosure, so it is a different layout of the same controls and
 * worth driving twice. Waits come from `support.ts`; the one abort below is
 * the failure state itself under test, never a shortcut.
 */

const LONG_NAME_ROUTE = '/routes/2022-cycling-esports-world-championships-route'

const searchBox = (page: Page) => page.getByRole('textbox', { name: 'Search routes' })
/** A `USelectMenu`'s trigger is a button carrying the filter's `aria-label`. */
const filter = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset' })
/** `DiscoveryStatus`'s live count line - "Finding routes…", then "N results found". */
const statusLine = (page: Page) => page.locator('p[aria-live="polite"]')
const notice = (page: Page) => page.getByRole('alert')
/** Every route card in the grid. `NextRaceCard` links into /events, so nothing else on this page matches. */
const cards = (page: Page) => page.locator('a[href^="/routes/"]')
const showMore = (page: Page) => page.getByRole('button', { name: /^Show more/ })
const finishTime = (page: Page) => page.locator('section:has(#ride-recommendation-heading) p.tabular-nums').first()
const answer = (page: Page) => page.locator('#ride-answer-heading + p')

/** How many routes the count line is reporting. */
async function reportedCount(page: Page): Promise<number> {
  await expect(statusLine(page)).toHaveText(/^\d+ results? found$/)
  return Number.parseInt((await statusLine(page).innerText()).split(' ')[0]!, 10)
}

/** Picks a filter option and waits for the list the change asks for. */
async function pickFilter(page: Page, name: string, option: string) {
  const responded = page.waitForResponse(response => response.url().includes('/api/routes'))
  await filter(page, name).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await responded
  await expect(statusLine(page)).not.toHaveText(/^Finding/)
}

/**
 * Tabs forward until `target` has focus, so a journey can assert reachability
 * and order without counting the tab stops of every control between them -
 * a count that a new filter would silently invalidate.
 */
async function tabTo(page: Page, target: Locator, limit = 25) {
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate(element => element === document.activeElement)) return
  }
  throw new Error(`focus never reached ${target} within ${limit} tabs`)
}

test.describe('route discovery', () => {
  test('filters to a world and a surface, opens a route, and comes back to the same view', async ({ page }) => {
    await visitPage(page, '/')
    await pickFilter(page, 'World', 'Watopia')
    await pickFilter(page, 'Surface', 'Includes gravel')
    await expect(page).toHaveURL(/[?&]world=watopia/)
    await expect(page).toHaveURL(/[?&]surface=gravel/)
    const filtered = await reportedCount(page)
    expect(filtered).toBeGreaterThan(0)
    expect(await cards(page).count()).toBe(Math.min(filtered, 24))

    const opened = cards(page).first()
    const href = (await opened.getAttribute('href'))!
    const name = await opened.locator('p').first().innerText()
    await opened.click()
    await page.waitForURL(`**${href}`)
    await ready(page)
    // The card led to this route's own ranking, not to a page that merely
    // loaded: the heading, the time and the sentence that explains the time
    // all have to name the route the card named. The listing itself is not
    // waited for - Nuxt answers a prefetched navigation from its payload
    // when the rider matches (`useRecommendRequest`'s #118/#121 contract),
    // so there is no request to wait on here.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
    const time = await finishTime(page).innerText()
    expect(time).toMatch(/^\d{1,2}:\d{2}(:\d{2})?$/)
    await expect(answer(page)).toContainText(`for ${name} in `)
    await expect(answer(page)).toContainText(time)

    await page.goBack()
    await expect(page).toHaveURL(/[?&]world=watopia/)
    await expect(filter(page, 'World')).toHaveText('Watopia')
    await expect(filter(page, 'Surface')).toHaveText('Includes gravel')
    expect(await reportedCount(page)).toBe(filtered)
  })

  test('says when nothing matched, and Reset brings the whole catalog back', async ({ page }) => {
    await visitPage(page, '/')
    const everything = await reportedCount(page)

    const responded = page.waitForResponse(response => response.url().includes('search=zzzzz'))
    await searchBox(page).fill('zzzzz')
    await responded
    await expect(page.getByText('No routes match your filters.')).toBeVisible()
    await expect(statusLine(page)).toHaveText('0 results found')
    await expect(cards(page)).toHaveCount(0)

    const reset = page.waitForResponse(response => response.url().includes('/api/routes') && !response.url().includes('search='))
    await resetButton(page).click()
    await reset
    await expect(searchBox(page)).toHaveValue('')
    expect(await reportedCount(page)).toBe(everything)
    await expect(page.getByText('No routes match your filters.')).toHaveCount(0)
  })

  test('reveals the next page of routes on demand', async ({ page }) => {
    await visitPage(page, '/')
    const everything = await reportedCount(page)
    expect(everything).toBeGreaterThan(24)
    await expect(cards(page)).toHaveCount(24)
    await expect(showMore(page)).toHaveText(`Show more (${everything - 24} remaining)`)

    await showMore(page).click()
    await expect(cards(page)).toHaveCount(Math.min(48, everything))
    if (everything > 48) await expect(showMore(page)).toHaveText(`Show more (${everything - 48} remaining)`)
    else await expect(showMore(page)).toHaveCount(0)
  })

  test('reaches the search, the filters and the first card from the skip link', async ({ page }) => {
    await visitPage(page, '/')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('main')).toBeFocused()

    await tabTo(page, searchBox(page))
    await tabTo(page, filter(page, 'World'))
    await tabTo(page, filter(page, 'Surface'))
    await tabTo(page, resetButton(page))
    const first = cards(page).first()
    const href = await first.getAttribute('href')
    await tabTo(page, first)
    await page.keyboard.press('Enter')
    await page.waitForURL(`**${href}`)
  })

  test('wraps a long event-only route name inside its own card', async ({ page }) => {
    await visitPage(page, '/')
    await pickFilter(page, 'World', 'New York')
    const long = page.locator(`a[href="${LONG_NAME_ROUTE}"]`)
    await expect(long).toBeVisible()
    await expect(long.getByText('Event only')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // A name that wraps must take more lines, never more width: a card wider
    // than its siblings is a grid cell that stretched.
    const widths = await cards(page).evaluateAll(elements =>
      elements.map(element => Math.round(element.getBoundingClientRect().width)))
    expect(widths.length).toBeGreaterThan(1)
    expect(new Set(widths).size).toBe(1)
  })

  test('keeps the previous routes on screen when a filter change fails, and retries', async ({ page }) => {
    await visitPage(page, '/')
    const before = await cards(page).evaluateAll(links => links.map(link => link.getAttribute('href')))
    expect(before.length).toBeGreaterThan(0)

    // The one abort in this file: a failed refetch is what the journey is
    // about, and no real filter change can be made to fail on demand.
    await page.route('**/api/routes**', route => route.abort())
    await filter(page, 'World').click()
    await page.getByRole('option', { name: 'New York', exact: true }).click()
    await expect(notice(page)).toContainText('Couldn\'t load routes.')
    expect(await cards(page).evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(before)

    await page.unroute('**/api/routes**')
    const responded = page.waitForResponse(response => response.url().includes('/api/routes') && response.ok())
    await notice(page).getByRole('button', { name: 'Try again' }).click()
    await responded
    await expect(notice(page)).toHaveCount(0)
    expect(await reportedCount(page)).toBeGreaterThan(0)
    expect(await cards(page).evaluateAll(links => links.map(link => link.getAttribute('href')))).not.toEqual(before)
  })

  test('serves real route links in the HTML a crawler reads', async ({ page, request }) => {
    await visitPage(page, '/')
    const html = await (await request.get('/')).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        heading: doc.querySelector('h1')?.textContent?.trim(),
        routeLinks: [...doc.querySelectorAll('a[href^="/routes/"]')].map(link => link.getAttribute('href')),
        // Two links reach /segments in the HTML: the shell's section entry
        // and the hero's cross-link. The cross-link is the one this page owns.
        segmentsLinks: [...doc.querySelectorAll('a[href="/segments"]')].map(link => link.textContent?.trim())
      }
    }, html)
    expect(served.heading).toBe('Find the best bike for your Zwift route')
    // The server renders the first page of cards, so the HTML carries 24
    // real hrefs - not an empty grid a crawler would have to hydrate.
    expect(served.routeLinks.length).toBe(24)
    expect(served.routeLinks).toContain(LONG_NAME_ROUTE)
    expect(served.segmentsLinks).toContain('Browse all segments')
  })

  test('puts the cards on the dark ground in dark mode', async ({ page }) => {
    await visitPage(page, '/')
    const cardGround = () => cards(page).first().locator('> *').first()
      .evaluate(element => getComputedStyle(element).backgroundColor)
    const lightGround = await cardGround()

    await page.getByRole('banner').getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    // The palette's deepest neutral, which `main.css` re-points `--ui-bg` to
    // in dark mode - not merely "whatever `--ui-bg` is", which would hold in
    // light mode too.
    const ground = await resolvedColor(page, 'var(--ui-color-neutral-950)')
    expect(ground).not.toBe(lightGround)
    expect(await cardGround()).toBe(ground)
    await expectNoHorizontalOverflow(page)
  })
})
