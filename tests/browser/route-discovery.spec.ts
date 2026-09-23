import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, ready, resolvedColor, seedRiderProfile, tabTo, visitPage } from './support'

/**
 * Route discovery (issues #210, #257): the homepage as the way into a
 * recommendation. Journeys assert what a rider gets - a live example with a
 * real answer, a filtered list of Silhouettes, a route page with a real time
 * on it, the same filtered list on the way back - and what a crawler gets,
 * which is real hrefs and a real finish time in the server's HTML rather than
 * a grid that only exists after hydration.
 *
 * Both projects run: the filter row wraps on a phone rather than collapsing
 * into a disclosure, so it is a different layout of the same controls and
 * worth driving twice. Waits come from `support.ts`; the one abort below is
 * the failure state itself under test, never a shortcut.
 */

const LONG_NAME_ROUTE = '/routes/2022-cycling-esports-world-championships-route'
/** The eight routes the homepage example rotates through when no race is coming up - see `homeExample.ts`. */
const CURATED = ['tempus-fugit', 'road-to-sky', 'the-mega-pretzel', 'big-loop', 'cobbled-climbs', 'champs-elysees', 'three-sisters', 'castle-crit']
/** A week with races still to come in the shipped calendars. */
const RACES_AHEAD = new Date('2026-09-25T12:00:00Z')
/** Past every race in the shipped calendars. */
const NO_RACES_AHEAD = new Date('2027-05-01T12:00:00Z')
const TERRAIN = /\b(Flat|Rolling|Hilly|Mountainous)\b/

const searchBox = (page: Page) => page.getByRole('textbox', { name: 'Search routes' })
/** A `USelectMenu`'s trigger is a button carrying the filter's `aria-label`. */
const filter = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const filters = (page: Page) => page.getByRole('group', { name: 'Route filters' })
const terrainChip = (page: Page, name: string) => filters(page).getByRole('button', { name, exact: true })
const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset' })
/** The live count line on the filter row - "Finding routes…", then "N routes found". */
const statusLine = (page: Page) => filters(page).locator('p[aria-live="polite"]')
const notice = (page: Page) => page.getByRole('alert')
/** Every route card in the finder - the example card and the next-race strip link elsewhere on the page. */
const cards = (page: Page) => page.locator('section:has(#route-finder-heading) a[href^="/routes/"]')
const showMore = (page: Page) => page.getByRole('button', { name: /^Show more/ })
const example = (page: Page) => page.locator('#home-example')
const finishTime = (page: Page) => page.locator('#ride-finish-time')
const answer = (page: Page) => page.locator('#ride-answer-heading + p')

/** How many routes the count line is reporting. */
async function reportedCount(page: Page): Promise<number> {
  await expect(statusLine(page)).toHaveText(/^\d+ routes? found$/)
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

/** A card's route name, as the card prints it. */
const cardName = async (card: Locator) => (await card.getByRole('heading').innerText()).trim()

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
    const name = await cardName(opened)
    await opened.click()
    await page.waitForURL(`**${href}`)
    await ready(page)
    // The card led to this route's own ranking, not to a page that merely
    // loaded: the heading, the time and the sentence that explains the time
    // all have to name the route the card named. The listing itself is not
    // waited for - Nuxt answers a prefetched navigation from its payload
    // when the rider matches (`useRecommendRequest`'s #118/#121 contract),
    // so there is no request to wait on here.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
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

  test('draws every route card as its Silhouette, with its terrain as text', async ({ page }) => {
    await visitPage(page, '/')
    const count = await cards(page).count()
    expect(count).toBe(24)
    await expect(cards(page).locator('svg[data-silhouette]')).toHaveCount(count)
    for (const text of await cards(page).allInnerTexts()) expect(text).toMatch(TERRAIN)
    await expectNoHorizontalOverflow(page)
  })

  test('narrows by terrain chips, keeps them in the URL, and restores them on return', async ({ page }) => {
    await visitPage(page, '/')
    const everything = await reportedCount(page)
    await terrainChip(page, 'Hilly').click()
    await expect(terrainChip(page, 'Hilly')).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/[?&]terrain=hilly/)
    const hilly = await reportedCount(page)
    expect(hilly).toBeGreaterThan(0)
    expect(hilly).toBeLessThan(everything)
    for (const text of await cards(page).allInnerTexts()) expect(text).toContain('Hilly')

    await terrainChip(page, 'Flat').click()
    await expect(page).toHaveURL(/[?&]terrain=flat(%2C|,)hilly/)
    const both = await reportedCount(page)
    expect(both).toBeGreaterThan(hilly)

    await visitPage(page, page.url())
    await expect(terrainChip(page, 'Flat')).toHaveAttribute('aria-pressed', 'true')
    await expect(terrainChip(page, 'Hilly')).toHaveAttribute('aria-pressed', 'true')
    await expect(terrainChip(page, 'Rolling')).toHaveAttribute('aria-pressed', 'false')
    expect(await reportedCount(page)).toBe(both)
  })

  test('says when nothing matched, and Reset brings the whole catalog back', async ({ page }) => {
    await visitPage(page, '/')
    const everything = await reportedCount(page)

    const responded = page.waitForResponse(response => response.url().includes('search=zzzzz'))
    await searchBox(page).fill('zzzzz')
    await responded
    await expect(page.getByText(/No routes match your filters\./)).toBeVisible()
    await expect(statusLine(page)).toHaveText('0 routes found')
    await expect(cards(page)).toHaveCount(0)

    const reset = page.waitForResponse(response => response.url().includes('/api/routes') && !response.url().includes('search='))
    await resetButton(page).click()
    await reset
    await expect(searchBox(page)).toHaveValue('')
    expect(await reportedCount(page)).toBe(everything)
    await expect(page.getByText(/No routes match your filters\./)).toHaveCount(0)
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
    await tabTo(page, terrainChip(page, 'Flat'))
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
    const long = page.locator(`section:has(#route-finder-heading) a[href="${LONG_NAME_ROUTE}"]`)
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
    await page.route('**/api/routes?**', route => route.abort())
    await filter(page, 'World').click()
    await page.getByRole('option', { name: 'New York', exact: true }).click()
    await expect(notice(page)).toContainText('Couldn\'t load routes.')
    expect(await cards(page).evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(before)
    // The cards below are the previous filter's, so no count is reported for
    // the filter that failed - and none is announced.
    await expect(statusLine(page)).toHaveText('')

    await page.unroute('**/api/routes?**')
    const responded = page.waitForResponse(response => response.url().includes('/api/routes') && response.ok())
    await notice(page).getByRole('button', { name: 'Try again' }).click()
    await responded
    await expect(notice(page)).toHaveCount(0)
    expect(await reportedCount(page)).toBeGreaterThan(0)
    expect(await cards(page).evaluateAll(links => links.map(link => link.getAttribute('href')))).not.toEqual(before)
  })

  test('serves real route links and a real answer in the HTML a crawler reads', async ({ page, request }) => {
    await visitPage(page, '/')
    const html = await (await request.get('/')).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        title: doc.title,
        heading: doc.querySelector('h1')?.textContent?.trim(),
        routeLinks: [...doc.querySelectorAll('section:has(#route-finder-heading) a[href^="/routes/"]')].map(link => link.getAttribute('href')),
        silhouettes: doc.querySelectorAll('section:has(#route-finder-heading) svg[data-silhouette]').length,
        example: doc.querySelector('#home-example')?.textContent?.replace(/\s+/g, ' ').trim(),
        exampleHref: doc.querySelector('#home-example')?.getAttribute('href'),
        segmentsLinks: [...doc.querySelectorAll('a[href="/segments"]')].map(link => link.textContent?.trim())
      }
    }, html)
    expect(served.heading).toBe('The fastest bike for any Zwift route')
    expect(served.title.toLowerCase()).toContain('fastest bike for')
    // The server renders the first page of cards, so the HTML carries 24
    // real hrefs - not an empty grid a crawler would have to hydrate.
    expect(served.routeLinks.length).toBe(24)
    expect(served.silhouettes).toBe(24)
    expect(served.routeLinks).toContain(LONG_NAME_ROUTE)
    // The example is prerendered for a curated route and the default rider,
    // with a real finish time a crawler can index.
    expect(served.example).toMatch(/\d{1,2}:\d{2}/)
    expect(served.example).toContain('For the default rider, 75 kg at 225 W')
    expect(CURATED.map(slug => `/routes/${slug}`)).toContain(served.exampleHref)
    expect(served.segmentsLinks).toContain('Browse segments')
  })

  test('shows the next race\'s route in the example once a race is coming up', async ({ page }) => {
    await page.clock.setFixedTime(RACES_AHEAD)
    await visitPage(page, '/')
    await expect(example(page)).toContainText(/^Next race: /)
    await expect(example(page)).toHaveAttribute('href', /^\/events\/[^/]+\/[^/]+$/)
    await expect(example(page)).toContainText(/\d{1,2}:\d{2}/)
    await expect(example(page)).toContainText('For the default rider, 75 kg at 225 W')
    await expectNoHorizontalOverflow(page)
  })

  test('shows today\'s curated route in the example when no race is coming up, for the rider who is stored', async ({ page }) => {
    await page.clock.setFixedTime(NO_RACES_AHEAD)
    await seedRiderProfile(page, { weightKg: 68, heightCm: 180, powerW: 260 })
    await visitPage(page, '/')
    await expect(example(page)).toContainText('For you, 68 kg at 260 W')
    await expect(example(page)).toContainText('Today\'s example')
    const href = await example(page).getAttribute('href')
    expect(CURATED.map(slug => `/routes/${slug}`)).toContain(href)
    await expect(example(page)).toContainText(/\d{1,2}:\d{2}/)
  })

  test('puts the cards on the dark ground, and lifts them off it on a switch to light', async ({ page }) => {
    await visitPage(page, '/')
    const cardGround = () => cards(page).first().evaluate(element => getComputedStyle(element).backgroundColor)
    const bodyGround = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    // A first visit is dark: the page on the palette's deepest neutral, a
    // card one step up on the raised surface - not merely "whatever the
    // tokens are", which would hold in light mode too.
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    expect(await bodyGround()).toBe(await resolvedColor(page, 'var(--ui-color-neutral-950)'))
    expect(await cardGround()).toBe(await resolvedColor(page, 'var(--ui-color-neutral-900)'))

    await page.getByRole('banner').getByRole('button', { name: 'Switch to light mode' }).click()
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    expect(await cardGround()).toBe('rgb(255, 255, 255)')
    expect(await bodyGround()).not.toBe(await cardGround())
    await expectNoHorizontalOverflow(page)
  })
})
