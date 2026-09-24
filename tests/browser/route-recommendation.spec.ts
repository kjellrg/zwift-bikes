import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, isListingResponse, rerank, visit } from './support'

/**
 * The route recommendation journey (issues #202, #257): the answer on the
 * first screen under the Course hero, the Rider card beside it, real results
 * through the page's own request, lap-aware totals, the Ranking table from
 * rank 1 with its rows' disclosures and comparison picks, catalog-wide
 * search, keyboard access, and the server-rendered answer a crawler reads.
 * Every wait comes from `support.ts` and is for a real signal, never a
 * sleep.
 *
 * Nothing here is committed as a screenshot; Playwright keeps failure
 * artefacts under `test-results/`, which is gitignored.
 */

const ROUTE = '/routes/hilly-route'

const recommendation = (page: Page) => page.locator('section:has(#ride-recommendation-heading)')
const riderCard = (page: Page) => page.locator('aside:has(#rider-card-heading)')
const answer = (page: Page) => page.locator('section:has(#ride-answer-heading)')
const finishTime = (page: Page) => page.locator('#ride-finish-time')
const table = (page: Page) => page.getByRole('table', { name: 'Ranked setups' })
/** One group per setup: the row and, when open, its detail row. */
const setups = (page: Page) => table(page).locator('tbody')
const facts = (page: Page) => page.getByRole('list', { name: 'Ride facts' })
const rideNotes = (page: Page) => page.getByRole('list', { name: 'About this ride' })
const hero = (page: Page) => page.locator('#course-hero')
const searchBox = (page: Page) => page.getByRole('textbox', { name: 'Search all frames and wheels' })
/** The frame name of every loaded setup, in rank order - rank 1 is the table's first row. */
const frameNames = (page: Page) => setups(page).getByRole('button', { name: /^Details for / }).allInnerTexts()
const disclosure = (setup: Locator) => setup.getByRole('button', { name: /^(Show|Hide) details for / })

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The FAQ answer in the page's JSON-LD, or undefined when there is none. */
async function structuredAnswer(page: Page) {
  return page.evaluate(() => {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      const schema = JSON.parse(script.textContent ?? '{}')
      if (schema['@type'] === 'FAQPage') return schema.mainEntity[0].acceptedAnswer.text as string
    }
    return undefined
  })
}

test.describe('route recommendation', () => {
  test('draws the course, then the answer with the Rider card beside it, the time on the first screen', async ({ page, isMobile }) => {
    await visit(page, ROUTE)
    await expect(hero(page)).toBeVisible()
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d(:\d\d)?$/)
    // The answer is on the first screen, even on a phone.
    const time = (await finishTime(page).boundingBox())!
    expect(time.y + time.height).toBeLessThanOrEqual(page.viewportSize()!.height)

    const pick = (await recommendation(page).boundingBox())!
    const card = (await riderCard(page).boundingBox())!
    const heroBox = (await hero(page).boundingBox())!
    expect(pick.y).toBeGreaterThan(heroBox.y + heroBox.height - 1)
    if (isMobile) {
      // Recommendation first in source order and above the card.
      expect(pick.y + pick.height).toBeLessThanOrEqual(card.y + 1)
    } else {
      expect(card.x).toBeGreaterThanOrEqual(pick.x + pick.width - 1)
      expect(pick.width).toBeGreaterThan(card.width)
    }
    // The answer paragraph sits directly under the band; the ranking follows
    // it and precedes the course section.
    const answerBox = (await answer(page).boundingBox())!
    expect(answerBox.y).toBeGreaterThanOrEqual(Math.max(pick.y + pick.height, card.y + card.height) - 1)
    expect((await table(page).boundingBox())!.y).toBeGreaterThan(answerBox.y)
    expect((await page.locator('#course-analysis').boundingBox())!.y).toBeGreaterThan((await table(page).boundingBox())!.y)
    await expectNoHorizontalOverflow(page)
  })

  test('shows the whole ranking as a table from rank 1, and reaches it from the answer', async ({ page }) => {
    await visit(page, ROUTE)
    const [rank1] = await recommendation(page).getByRole('button', { name: /^Details for / }).allInnerTexts()
    expect(await setups(page).first().locator('tr').first().innerText()).toMatch(/^1\b/)
    expect((await frameNames(page))[0]).toBe(rank1)
    await expect(setups(page).first()).toContainText('fastest')
    // The row controls exist once: none of them on the answer.
    await expect(recommendation(page).getByRole('checkbox')).toHaveCount(0)
    await expect(recommendation(page).getByRole('button', { name: /^Wheel alternatives|^Show details/ })).toHaveCount(0)

    await recommendation(page).getByRole('link', { name: 'See the full ranking' }).click()
    expect(new URL(page.url()).hash).toBe('#ride-ranking')
    await expect(page.getByRole('heading', { name: 'Every setup, ranked' })).toBeInViewport()
  })

  test('renders the same answer for riders and crawlers, from the server', async ({ page, request }) => {
    await visit(page, ROUTE)
    const visible = normalise(await answer(page).locator('p').allInnerTexts().then(lines => lines.join(' ')))
    expect(visible).toMatch(/^ZwiftBikes predicts the .+ is the best bike and wheels for Watopia Hilly Route in Watopia: the fastest road setup for an? \d+ kg rider at \d+ W, finishing in \d+:\d\d/)
    // Rank 2 and its gap, always: rank 1 alone would overstate a margin that is usually under a second.
    expect(visible).toMatch(/ The .+ (is .+ behind|is tied with it)/)
    expect(normalise((await structuredAnswer(page)) ?? '')).toBe(visible)
    await expect(page).toHaveTitle(/^Fastest bike for Watopia Hilly Route in Watopia \| ZwiftBikes$/)

    // The prerendered HTML, not the hydrated page: what a crawler gets.
    const html = await (await request.get(ROUTE)).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        title: doc.title,
        heading: doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim(),
        answer: doc.querySelector('#ride-answer-heading + p')?.textContent,
        description: doc.querySelector('meta[name="description"]')?.getAttribute('content'),
        facts: doc.querySelector('[aria-label="Ride facts"]')?.textContent,
        rows: doc.querySelectorAll('table[aria-label="Ranked setups"] tbody').length,
        canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        segmentLinks: [...doc.querySelectorAll('a[href^="/segments/"]')].map(link => [link.getAttribute('href'), link.textContent?.trim()]),
        related: [...doc.querySelectorAll('section:has(#related-routes-heading) a[href^="/routes/"]')].length,
        faq: [...doc.querySelectorAll('script[type="application/ld+json"]')]
          .map(script => JSON.parse(script.textContent ?? '{}'))
          .find(schema => schema['@type'] === 'FAQPage')?.mainEntity[0].acceptedAnswer.text as string | undefined
      }
    }, html)
    expect(served.title.toLowerCase()).toContain('fastest bike for')
    expect(served.heading).toBe('The fastest bike for Watopia Hilly Route')
    expect(served.answer).toMatch(/^ZwiftBikes predicts the /)
    expect(served.faq).toMatch(/^ZwiftBikes predicts the /)
    // The search phrase, then the default rider's rank 1 - never a time.
    expect(served.description).toMatch(/^The best bike and wheels for Watopia Hilly Route.*: ZwiftBikes predicts the .+, fastest on road bikes\.$/)
    expect(served.description!.length).toBeLessThanOrEqual(160)
    expect(served.facts).toContain('m/km')
    expect(served.rows).toBeGreaterThan(1)
    expect(served.related).toBe(4)
    expect(served.canonical).toMatch(/\/routes\/hilly-route$/)
    expect(served.segmentLinks).toContainEqual(['/segments/zwift-kom', 'Fastest bike for Zwift KOM'])
  })

  test('recomputes totals, the time and the answer for a second lap, and carries it in the URL', async ({ page }) => {
    await visit(page, ROUTE)
    const distanceBefore = Number.parseFloat(await facts(page).locator('li').first().innerText())
    const timeBefore = await finishTime(page).innerText()

    const { data } = await rerank(page, async () => {
      // The lap picker is the Rider card's `USelectMenu`: its trigger is a button carrying the label.
      await page.getByRole('button', { name: 'Laps' }).click()
      await page.getByRole('option', { name: '2 laps', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Laps' })).toHaveText('2 laps')
    })
    const distanceAfter = Number.parseFloat(await facts(page).locator('li').first().innerText())
    // One more lap of 9.2 km on top of the lead-in: more than 1.9x the single-lap total, less than 2x.
    expect(distanceAfter).toBeGreaterThan(distanceBefore * 1.9)
    expect(distanceAfter).toBeLessThan(distanceBefore * 2)
    await expect(finishTime(page)).not.toHaveText(timeBefore)
    expect(data.combos[0]?.finishTimeSec).toBeDefined()
    await expect(finishTime(page)).toHaveText(formatDuration(data.combos[0]!.finishTimeSec!))
    await expect(answer(page)).toContainText('2 laps, including any lead-in once')
    expect(new URL(page.url()).searchParams.get('laps')).toBe('2')
    await expect(rideNotes(page)).toContainText('2 laps')
  })

  test('opens one row at a time, by pointer and keyboard, with its wheels fetched through the page\'s request', async ({ page, isMobile }) => {
    await visit(page, ROUTE)
    const first = setups(page).nth(0)
    const second = setups(page).nth(1)
    const wheels = page.waitForResponse(response => response.url().includes('wheelsForFrame'))
    // A click anywhere on the row that is not one of its own controls.
    await first.locator('tr').first().locator('td').nth(2).click()
    expect((await wheels).ok()).toBe(true)
    await expect(disclosure(first)).toHaveAttribute('aria-expanded', 'true')
    await expect(first.getByText('Gaps are against the fastest wheels for this frame')).toBeVisible()
    await expect(first.getByRole('list', { name: /^Wheel alternatives for / }).getByText('this row')).toBeVisible()
    await expect(first.getByText('Versus the stock Zwift bike')).toBeVisible()

    // Opening the next closes the first.
    await disclosure(second).click()
    await expect(disclosure(second)).toHaveAttribute('aria-expanded', 'true')
    await expect(disclosure(first)).toHaveAttribute('aria-expanded', 'false')

    if (!isMobile) {
      await disclosure(second).focus()
      await page.keyboard.press('Enter')
      await expect(disclosure(second)).toHaveAttribute('aria-expanded', 'false')
      await page.keyboard.press('Space')
      await expect(disclosure(second)).toHaveAttribute('aria-expanded', 'true')
    }
    await expectNoHorizontalOverflow(page)
  })

  test('compares up to three setups side by side, rank 1 among them, from their rows', async ({ page }) => {
    await visit(page, ROUTE)
    expect(await setups(page).count()).toBeGreaterThanOrEqual(4)
    for (const index of [0, 1, 2]) {
      await disclosure(setups(page).nth(index)).click()
      await setups(page).nth(index).getByRole('checkbox', { name: /^Compare / }).check()
    }
    await disclosure(setups(page).nth(3)).click()
    await expect(setups(page).nth(3).getByRole('checkbox', { name: /^Compare / })).toBeDisabled()

    const comparison = page.getByRole('region', { name: /Selected setups/ })
    await expect(comparison).toContainText('Fastest in results')
    await expect(comparison).toContainText(/\+\d+\.\d\ds|\+\d+:\d\d/)

    // The persistent control where the picks are made, landing focus on the comparison.
    await page.mouse.wheel(0, -4000)
    await page.getByRole('button', { name: /^Show comparison, 3 of 3/ }).click()
    await expect(comparison).toBeInViewport()
    expect(await comparison.evaluate(section => section === document.activeElement)).toBe(true)

    await comparison.getByRole('button', { name: /Remove .* from comparison/ }).first().click()
    await expect(page.getByRole('button', { name: /^Show comparison, 2 of 3/ })).toBeVisible()
    await expect(setups(page).nth(3).getByRole('checkbox', { name: /^Compare / })).toBeEnabled()
    await comparison.getByRole('button', { name: 'Clear comparison' }).click()
    await expect(comparison).toHaveCount(0)
  })

  test('opens the details drawer from the keyboard and returns focus to the name', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard access is a desktop journey')
    await visit(page, ROUTE)
    const name = recommendation(page).getByRole('button', { name: /^Details for / }).first()
    // Read before opening: a modal dialog hides the rest of the page from the accessibility tree.
    const frameName = await name.innerText()
    await name.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(frameName)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(name).toBeFocused()
  })

  test('appends the next rows without moving the ones already read', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers pagination')
    await visit(page, ROUTE)
    const before = await setups(page).count()
    const bars = () => setups(page).getByRole('meter', { name: /^Gap to the fastest/ }).evaluateAll(meters => meters.map(meter => meter.getAttribute('aria-valuenow')))
    const barsBefore = await bars()
    const nextPage = page.waitForResponse(response => isListingResponse(response) && response.url().includes('offset='))
    await page.getByRole('button', { name: /^Show the next \d+$/ }).click()
    expect((await nextPage).ok()).toBe(true)
    await expect.poll(() => setups(page).count()).toBeGreaterThan(before)
    // The gap bars are scaled to the first page and never rescaled.
    const barsAfter = await bars()
    expect(barsAfter.slice(0, barsBefore.length)).toEqual(barsBefore)
  })

  test('keeps "all columns" as a preference, scrolling inside the table, without touching the rest', async ({ page, isMobile }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('zwift-bikes:preferences')) {
        localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ verifiedOnly: true, myBikesOnly: false, bikeCategory: 'standard', showUpcomingRaces: false, includeHaloBikes: false }))
      }
    })
    await visit(page, ROUTE)
    await page.getByRole('switch', { name: 'All columns' }).click()
    await expect(table(page).getByRole('columnheader', { name: 'Drag area Δ' })).toBeVisible()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('zwift-bikes:preferences') ?? '{}'))
    expect(stored).toEqual({ verifiedOnly: true, myBikesOnly: false, bikeCategory: 'standard', showUpcomingRaces: false, includeHaloBikes: false, allColumns: true })
    await expectNoHorizontalOverflow(page)
    if (isMobile) {
      expect(await table(page).evaluate(element => element.parentElement!.scrollWidth > element.parentElement!.clientWidth)).toBe(true)
    }

    await visit(page, ROUTE)
    await expect(page.getByRole('switch', { name: 'All columns' })).toBeChecked()
    await expect(table(page).getByRole('columnheader', { name: 'Data' })).toBeVisible()
  })

  test('search reaches a Halo bike the default filter hides, and clearing it restores the ranking', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers search')
    await visit(page, ROUTE)
    await expect(recommendation(page)).not.toContainText('PROJECT 74')
    const { data: found } = await rerank(page, () => searchBox(page).fill('PROJECT 74'))
    expect(found.combos[0]?.frame.name).toContain('PROJECT 74')
    await expect(recommendation(page)).toContainText('PROJECT 74')
    await expect(answer(page)).toContainText('Halo bikes included; search: PROJECT 74')
    await expect(recommendation(page)).toContainText('search "PROJECT 74"')
    expect(new URL(page.url()).searchParams.get('bike')).toBe('PROJECT 74')

    await rerank(page, () => page.getByRole('button', { name: 'Clear search' }).click())
    await expect(recommendation(page)).not.toContainText('PROJECT 74')
    await expect(answer(page)).toContainText('unowned Halo bikes excluded')
  })

  test('finds a frame beyond the loaded pages, and a wheel by name, without loading more first', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers search')
    await visit(page, ROUTE)
    // Which frame is out of reach is read off the ranking itself, never
    // hardcoded and never a rank: equipment data drifts, and page one with it.
    const onPageOne = await frameNames(page)
    const nextPage = page.waitForResponse(response => isListingResponse(response) && response.url().includes('offset='))
    await page.getByRole('button', { name: /^Show the next \d+$/ }).click()
    expect((await nextPage).ok()).toBe(true)
    await expect.poll(() => setups(page).count()).toBeGreaterThan(onPageOne.length)
    const beyondPageOne = (await frameNames(page)).find(name => !onPageOne.includes(name))
    expect(beyondPageOne, 'page two lists a frame page one did not').toBeTruthy()

    const { data } = await rerank(page, () => searchBox(page).fill(beyondPageOne!))
    expect(data.pagination?.offset).toBe(0)
    expect(data.combos.map(combo => combo.frame.name)).toContain(beyondPageOne)
    await expect(table(page)).toContainText(beyondPageOne!)

    // A wheel name reaches the catalog the same way; the per-frame cap is
    // lifted for a search (`recommendPipeline.test.ts` holds that rule).
    const { data: wheels } = await rerank(page, () => searchBox(page).fill('zipp'))
    expect(wheels.combos.length).toBeGreaterThan(1)
    expect(wheels.combos.every(combo => combo.wheelset?.name.toLowerCase().includes('zipp'))).toBe(true)
    await expect(recommendation(page)).toContainText('Zipp')
  })

  test('keeps a long route name and the dark Colour mode within the viewport', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'dark'))
    await visit(page, '/routes/2022-cycling-esports-world-championships-route')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/2022 Cycling Esports World Championships Route$/)
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d(:\d\d)?$/)
    await expectNoHorizontalOverflow(page)
    await table(page).scrollIntoViewIfNeeded()
    await expectNoHorizontalOverflow(page)
  })

  test('replaces the hero with a line, and says what data is missing, on a route with no measured profile', async ({ page }) => {
    await visit(page, '/routes/flat-route-rev')
    await expect(hero(page)).toHaveCount(0)
    await expect(page.locator('#course-hero-unavailable')).toContainText('terrain is approximated')
    await expect(facts(page)).toBeVisible()
    await expect(recommendation(page)).toContainText('Limited route data: elevation and surface locations unavailable.')
    await expect(rideNotes(page)).toContainText('road assumed by model')
  })
})

/** `formatDuration` as the pages render it - kept in step by the assertion above, not imported, so the spec stays free of app modules. */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}
