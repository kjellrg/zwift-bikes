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
 * worth driving twice. Waits come from `support.ts`. The page carries every
 * route's card and filters them in the browser (#262), so a filter change
 * has no response to wait for: a journey waits for what the rider sees.
 */

const LONG_NAME_ROUTE = '/routes/2022-cycling-esports-world-championships-route'
/** The eight routes the homepage example rotates through when no race is coming up - see `homeExample.ts`. */
const CURATED = ['tempus-fugit', 'road-to-sky', 'the-mega-pretzel', 'big-loop', 'cobbled-climbs', 'champs-elysees', 'three-sisters', 'castle-crit']
/** A week with races still to come in the shipped calendars. */
const RACES_AHEAD = new Date('2026-09-25T12:00:00Z')
/** Past every race in the shipped calendars. */
const NO_RACES_AHEAD = new Date('2027-05-01T12:00:00Z')
const TERRAIN = /\b(Flat|Rolling|Hilly|Mountainous)\b/

/** The hero search, a combobox since #331. */
const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search routes' })
const results = (page: Page) => page.getByRole('listbox', { name: 'Search results' })
const resultGroup = (page: Page, name: string) => results(page).getByRole('group', { name })
/** A `USelectMenu`'s trigger is a button carrying the filter's `aria-label`. */
const filter = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const filters = (page: Page) => page.getByRole('group', { name: 'Route filters' })
const terrainChip = (page: Page, name: string) => filters(page).getByRole('button', { name, exact: true })
/** The filter row's Reset - the search's empty state has one of its own. */
const resetButton = (page: Page) => filters(page).getByRole('button', { name: 'Reset', exact: true })
/** The route grid and everything above it in its section, below the filter row. */
const finder = (page: Page) => page.locator('section:has(#route-finder-heading)')
/** The live count line on the filter row - "N routes found". */
const statusLine = (page: Page) => filters(page).locator('p[aria-live="polite"]')
/** Every route card in the finder - the example card links to a route too, from outside the finder. */
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

/** Picks a filter option; the list follows in the same render as the control's label. */
async function pickFilter(page: Page, name: string, option: string) {
  await filter(page, name).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await expect(filter(page, name)).toHaveText(option)
}

/** Every route-listing request the page makes from here on - there should be none. */
function listingRequests(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (request) => {
    if (/\/api\/route(s|-cards)\b/.test(request.url())) seen.push(request.url())
  })
  return seen
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

  test('says when the filters leave nothing, and Reset brings the whole catalog back', async ({ page }) => {
    await visitPage(page, '/')
    const everything = await reportedCount(page)

    // A term that names routes, narrowed to a world that has none of them:
    // the filters' message, not the search's.
    await searchBox(page).fill('road to sky')
    await pickFilter(page, 'World', 'London')
    await expect(page.getByText(/No routes match your filters\./)).toBeVisible()
    await expect(statusLine(page)).toHaveText('0 routes found')
    await expect(cards(page)).toHaveCount(0)

    await resetButton(page).click()
    await expect(searchBox(page)).toHaveValue('')
    await expect(statusLine(page)).toHaveText(`${everything} routes found`)
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

  test('filters in the browser: every control narrows the list without a request', async ({ page }) => {
    await visitPage(page, '/')
    const everything = await reportedCount(page)
    const requests = listingRequests(page)

    await searchBox(page).fill('loop')
    await expect(statusLine(page)).not.toHaveText(`${everything} routes found`)
    for (const found of await cards(page).all()) expect((await cardName(found)).toLowerCase()).toContain('loop')
    await searchBox(page).fill('')
    await expect(statusLine(page)).toHaveText(`${everything} routes found`)

    // Worlds in the game's own order, Watopia - the most ridden - first, as on the segments page.
    await filter(page, 'World').click()
    await expect(page.getByRole('option').nth(1)).toHaveText('Watopia')
    await page.keyboard.press('Escape')
    await pickFilter(page, 'World', 'London')
    const london = await reportedCount(page)
    for (const text of await cards(page).allInnerTexts()) expect(text).toContain('London')
    await pickFilter(page, 'Surface', 'Includes cobbles')
    const cobbled = await reportedCount(page)
    expect(cobbled).toBeLessThan(london)
    await terrainChip(page, 'Flat').click()
    await expect(page).toHaveURL(/[?&]terrain=flat/)
    for (const text of await cards(page).allInnerTexts()) expect(text).toContain('Flat')
    expect(await reportedCount(page)).toBeLessThanOrEqual(cobbled)
    await resetButton(page).click()
    await expect(statusLine(page)).toHaveText(`${everything} routes found`)

    expect(requests).toEqual([])
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

  test('answers in a list under the search: arrow down and Enter open the route, and back restores the search', async ({ page }) => {
    await visitPage(page, '/')
    await searchBox(page).fill('road to sky')
    await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'true')
    const first = resultGroup(page, 'Routes').getByRole('option').first()
    await expect(first).toContainText('Road to Sky')
    await expect(first.locator('svg[data-silhouette]')).toHaveCount(1)
    // Identity and the numbers a rider chooses by - no time, no setup.
    await expect(first).toContainText(/Watopia · \d+\.\d km · \d+ m/)
    await expect(first).not.toContainText(/\d:\d{2}/)

    await page.keyboard.press('ArrowDown')
    await expect(first).toHaveAttribute('aria-selected', 'true')
    await expect(searchBox(page)).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!)
    // Enter before the grid's debounce has settled: the term still has to
    // reach the URL before the page is left, or back would lose it.
    await page.keyboard.press('Enter')
    await page.waitForURL('**/routes/road-to-sky')
    await ready(page)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Road to Sky')

    await page.goBack()
    await expect(page).toHaveURL(/[?&]q=road(\+|%20)to(\+|%20)sky/)
    await expect(searchBox(page)).toHaveValue('road to sky')
    for (const found of await cards(page).all()) expect((await cardName(found)).toLowerCase()).toContain('road to sky')
  })

  test('finds a climb by name and opens its segment page from the keyboard', async ({ page }) => {
    await visitPage(page, '/')
    const segmentRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/segments')
    await searchBox(page).focus()
    await segmentRequest
    await page.keyboard.type('alpe')
    const alpe = resultGroup(page, 'Climbs and sprints').getByRole('option', { name: /Alpe du Zwift/ })
    await expect(alpe).toBeVisible()
    await expect(alpe).toContainText('Climb · Watopia')

    const id = (await alpe.getAttribute('id'))!
    for (let step = 0; step < 12 && await searchBox(page).getAttribute('aria-activedescendant') !== id; step++) {
      await page.keyboard.press('ArrowDown')
    }
    await expect(searchBox(page)).toHaveAttribute('aria-activedescendant', id)
    await page.keyboard.press('Enter')
    await page.waitForURL('**/segments/alpe-du-zwift')
  })

  test('closes the list on Esc and keeps the term', async ({ page }) => {
    await visitPage(page, '/')
    await searchBox(page).fill('loop')
    await expect(results(page).getByRole('option').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(results(page)).toBeHidden()
    await expect(searchBox(page)).toHaveValue('loop')
    await expect(searchBox(page)).toBeFocused()
  })

  test('matches names whatever their accents and hyphens, and worlds by name', async ({ page }) => {
    await visitPage(page, '/')
    const routeOptions = resultGroup(page, 'Routes').getByRole('option')
    await searchBox(page).fill('casse pattes')
    await expect(routeOptions.first()).toContainText('Casse-Pattes')
    await searchBox(page).fill('champs elysees')
    await expect(routeOptions.first()).toContainText('Champs-Élysées')
    await searchBox(page).fill('makuri')
    await expect(routeOptions.first()).toBeVisible()
    for (const text of await routeOptions.allInnerTexts()) expect(text).toContain('Makuri Islands')
    // The grid follows the same rules: every card it keeps is in Makuri Islands.
    await expect(statusLine(page)).not.toHaveText(/^\d{3} routes/)
    for (const text of await cards(page).allInnerTexts()) expect(text).toContain('Makuri Islands')
  })

  test('names a term that found nothing, offers the nearest routes, and resets from inside the message', async ({ page }) => {
    await visitPage(page, '/')
    const everything = await reportedCount(page)
    const segmentRequest = page.waitForResponse(response => new URL(response.url()).pathname === '/api/segments')
    await searchBox(page).focus()
    await segmentRequest
    await page.keyboard.type('rod to skye')

    const message = 'No route or segment named “rod to skye”.'
    // In the dropdown, where the rider is looking ...
    const dropdown = page.locator('div:has(> [role="listbox"])')
    await expect(dropdown.getByText(message)).toBeVisible()
    await expect(dropdown.getByRole('link', { name: 'Road to Sky' })).toHaveAttribute('href', '/routes/road-to-sky')
    // ... and above the grid, where the count line still says so.
    await expect(finder(page).getByText(message)).toHaveCount(1)
    await expect(statusLine(page)).toHaveText('0 routes found')

    await dropdown.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(searchBox(page)).toHaveValue('')
    await expect(statusLine(page)).toHaveText(`${everything} routes found`)
    await expect(page.getByText(message)).toHaveCount(0)
  })

  test('loads no segments with the page, only once the search is used', async ({ page }) => {
    const segmentRequests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/segments') segmentRequests.push(request.url())
    })
    await visitPage(page, '/')
    expect(segmentRequests).toEqual([])
    const fetched = page.waitForResponse(response => new URL(response.url()).pathname === '/api/segments')
    await searchBox(page).click()
    await fetched
    await searchBox(page).fill('a')
    await searchBox(page).fill('al')
    expect(segmentRequests).toHaveLength(1)
  })

  test('opens the first results where a phone\'s keyboard leaves them visible', async ({ page }, testInfo) => {
    await visitPage(page, '/')
    await searchBox(page).click()
    await page.keyboard.type('loop')
    const first = results(page).getByRole('option').first()
    await expect(first).toBeVisible()
    const box = (await first.boundingBox())!
    const viewport = page.viewportSize()!
    // A phone's keyboard covers roughly the lower half of the screen; the
    // first result has to sit above it. On a desktop it simply has to be on screen.
    expect(box.y + box.height).toBeLessThanOrEqual(testInfo.project.name === 'mobile' ? viewport.height * 0.5 : viewport.height)
  })

  test('names gravel and cobbles in the card text and in a legend over the grid', async ({ page }) => {
    await visitPage(page, '/')
    await expect(finder(page).getByText('Under each profile, the surface strip marks')).toBeVisible()
    await pickFilter(page, 'Surface', 'Includes gravel')
    for (const text of await cards(page).allInnerTexts()) expect(text).toMatch(/ · Gravel\b/)
    await pickFilter(page, 'Surface', 'Includes cobbles')
    for (const text of await cards(page).allInnerTexts()) expect(text).toMatch(/ · Cobbles\b/)
    await resetButton(page).click()
    await searchBox(page).fill('tempus fugit')
    await expect(cards(page)).toHaveCount(1)
    await expect(cards(page).first()).not.toContainText(/Gravel|Cobbles/)
  })
})
