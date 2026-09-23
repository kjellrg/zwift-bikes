import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, isListingResponse, isListingUrl, navigateUnderOverlay, ready, rerank, visit } from './support'

/**
 * The race recommendation journey (issues #217, #257): a race page built from the
 * same parts as the route page, plus the two things only a race has - rules
 * about what may be started on, and a category group that moves the course
 * under the ranking. Real results through the page's own request, the
 * legality rules stated where a rider and a crawler both read them, the
 * applied course never mixed with another group's ranking, the scoring tab,
 * and a link that reproduces a view without touching what the rider saved.
 * Every wait comes from `support.ts` and is for a real signal, never a sleep.
 *
 * Nothing here is committed as a screenshot; Playwright keeps failure
 * artefacts under `test-results/`, which is gitignored.
 */

/** A scratch race: Zwift bars TT frames. One group, so no selector. */
const SCRATCH = '/events/zracing-2026/stage-1'
/** WTRL's Race of Truth: drafting off, TT frames banned by regulation, scoring segments published. */
const RACE_OF_TRUTH = '/events/zrl-2026-27/round-1-week-1'
/** Split by laps on one course: A/B ride 4 of Innsbruckring, C/D ride 3. */
const SPLIT_BY_LAPS = '/events/zrl-2026-27/round-1-week-2'
/** Split by course over one lap: A/B on Makuri 40, C/D on Urumaze. A points race, so it scores. */
const SPLIT_BY_COURSE = '/events/zrl-2026-27/round-1-week-3'
/** A team time trial: TT frames are legal here, and TTT drafting has a plan. */
const TTT = '/events/zrl-2026-27/round-1-week-4'

const recommendation = (page: Page) => page.locator('section:has(#ride-recommendation-heading)')
const riderCard = (page: Page) => page.locator('aside:has(#rider-card-heading)')
const facts = (page: Page) => page.getByRole('list', { name: 'Ride facts' })
const rideNotes = (page: Page) => page.getByRole('list', { name: 'About this ride' })
const hero = (page: Page) => page.locator('#course-hero')
const answer = (page: Page) => page.locator('section:has(#ride-answer-heading)')
const finishTime = (page: Page) => page.locator('#ride-finish-time')
const rows = (page: Page) => page.getByRole('table', { name: 'Ranked setups' }).locator('tbody')
const groupPicker = (page: Page) => page.getByRole('button', { name: 'Your race group' })
/** The Fact row's first number: the total distance for the selected group. */
const totalDistance = (page: Page) => facts(page).locator('li').first()
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
/** The category chip above the table, named for the category it shows. */
const categoryChip = (page: Page) => page.getByRole('button', { name: /^Category: / })
const panel = (page: Page, name: string) => page.getByRole('tabpanel', { name, exact: true })

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Picks a category group and waits for the ranking that group triggers. */
async function pickGroup(page: Page, label: string | RegExp) {
  return rerank(page, async () => {
    await groupPicker(page).click()
    await page.getByRole('option', { name: label }).click()
  })
}

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

test.describe('race recommendation', () => {
  test('puts the answer under the course, the Rider card beside it, and the time on a phone\'s first screen', async ({ page, isMobile }) => {
    await visit(page, SCRATCH)
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d(:\d\d)?$/)
    if (isMobile) {
      const time = (await finishTime(page).boundingBox())!
      expect(time.y + time.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    }

    await visit(page, SPLIT_BY_COURSE)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/The fastest bike for\s*Round 1 Week 3: Makuri 40/)
    await expect(page).toHaveTitle(/fastest bike for/i)
    const pick = (await recommendation(page).boundingBox())!
    const card = (await riderCard(page).boundingBox())!
    const answerBox = (await answer(page).boundingBox())!
    if (isMobile) {
      expect(pick.y + pick.height).toBeLessThanOrEqual(card.y + 1)
    } else {
      expect(card.x).toBeGreaterThanOrEqual(pick.x + pick.width - 1)
      expect(pick.width).toBeGreaterThan(card.width)
    }
    expect(answerBox.y).toBeGreaterThanOrEqual(Math.max(pick.y + pick.height, card.y + card.height) - 1)
    // The ranking follows the answer and precedes the course section.
    expect(await page.evaluate(() => {
      const ranking = document.querySelector('#ride-ranking')!
      const analysis = document.querySelector('#course-analysis')!
      return Boolean(ranking.compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING)
    })).toBe(true)
    // The table starts at rank 1.
    expect(await rows(page).first().locator('tr').first().innerText()).toMatch(/^1\b/)
    await expectNoHorizontalOverflow(page)
  })

  test('bars TT frames from the ranking, the category filter and the answer alike', async ({ page }) => {
    // The rider stores `tt`, which this race cannot honour: the ranking is
    // made across every legal category instead, the filter says so, and the
    // stored preference survives for the pages where TT is legal.
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ bikeCategory: 'tt' })))
    const listing = page.waitForResponse(isListingResponse)
    await visit(page, SCRATCH)
    const query = new URL((await listing).url()).searchParams
    expect(query.get('excludeTT')).toBe('true')
    expect(query.get('category'), 'a stored TT category cannot narrow a race that bars TT frames').toBeNull()

    await expect(rideNotes(page)).toContainText('Zwift disables TT frames for scratch races')
    await expect(answer(page)).toContainText('TT bikes are disabled for this scratch race.')
    await expect(categoryChip(page)).toHaveText('All categories')
    await expect(riderCard(page)).toContainText('Zwift disables TT frames for scratch races.')

    // The option itself is gone from both levers: a filter must not offer a
    // category the ranking below would refuse to show.
    await categoryChip(page).click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'All categories' })).toBeVisible()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Time Trial' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('combobox', { name: 'Bike category' }).click()
    await expect(page.getByRole('option', { name: 'All categories' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Time Trial' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zwift-bikes:preferences') ?? '{}').bikeCategory))
      .toBe('tt')
  })

  test('rides a Race of Truth solo, with the draft lever fixed rather than lying', async ({ page }) => {
    // A stored race-draft profile the race cannot honour: the ranking is made
    // solo, and the lever that would change it is shown fixed, with the reason.
    // No request goes out at all - solo is what the page was prerendered with,
    // so the substitution lands on the payload the page already has.
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:rider-profile', JSON.stringify({ draftMode: 'race' })))
    let ranked = 0
    page.on('response', response => void (isListingResponse(response) && (ranked += 1)))
    await visit(page, RACE_OF_TRUTH)
    expect(ranked, 'the stored mode is substituted, not fetched around').toBe(0)
    await expect(answer(page)).toContainText('/ solo;')

    // A rule, not a nudge: stated in the notes, with nothing to switch to.
    await expect(rideNotes(page)).toContainText('No draft in a Race of Truth, so the ranking is ridden solo')
    await expect(page.getByRole('button', { name: 'Dismiss draft mode hint' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Rider' })).toContainText('Solo')
    // The card shows the draft as fixed, with its reason: a live-looking
    // control that changed nothing would be a lie about the times below.
    await expect(page.getByRole('button', { name: /draft mode/i })).toHaveCount(0)
    await expect(riderCard(page)).toContainText('WTRL turns the draft off for a Race of Truth.')
    await expect(riderCard(page).getByRole('slider').first()).toBeVisible()
    await expect(riderCard(page).getByText(/paceline/)).toHaveCount(0)

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zwift-bikes:rider-profile') ?? '{}').draftMode))
      .toBe('race')
  })

  test('moves the facts, the course and the ranking together when the group changes the lap count', async ({ page }) => {
    await visit(page, SPLIT_BY_LAPS)
    await expect(groupPicker(page)).toHaveText('A/B - 4 laps')
    // The group is chosen in the header, above the Fact row and the hero it redraws.
    const pickerBox = (await groupPicker(page).boundingBox())!
    const factsBox = (await facts(page).boundingBox())!
    expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(factsBox.y + 1)
    expect(factsBox.y).toBeLessThan((await hero(page).boundingBox())!.y)
    const fourLapDistance = Number.parseFloat(await totalDistance(page).innerText())
    await expect(facts(page)).toContainText('4 laps')
    await expect(riderCard(page)).toContainText('4 laps')

    const { data, query } = await pickGroup(page, 'C/D - 3 laps')
    expect(query.get('laps')).toBe('3')
    const threeLapDistance = Number.parseFloat(await totalDistance(page).innerText())
    expect(threeLapDistance).toBeLessThan(fourLapDistance)
    await expect(facts(page)).toContainText('3 laps')
    await expect(riderCard(page)).toContainText('Set by the C/D race group')
    await expect(answer(page)).toContainText('3 laps, including any lead-in once')
    expect(data.combos[0]?.finishTimeSec).toBeDefined()
    await expect(finishTime(page)).toHaveText(formatDuration(data.combos[0]!.finishTimeSec!))
    expect(new URL(page.url()).searchParams.get('group')).toBe('1')
  })

  test('never pairs one group\'s course with another group\'s ranking', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the applied-course discipline')
    await visit(page, SPLIT_BY_COURSE)
    await tab(page, 'Speed by surface').click()
    await expect(panel(page, 'Speed by surface')).toContainText('225 W')
    // Settled on one course, nothing needs naming a second one.
    await expect(panel(page, 'Speed by surface')).not.toContainText('Urumaze')

    // The window between the group moving and its ranking landing - where
    // the chart must keep describing the course its setup was ranked on, and
    // where a ranking that lands before its course lookup has no course at
    // all - is the request module's rule, and is held open and asserted in
    // `useRecommendRequest.test.ts` rather than by intercepting requests
    // here. What the browser proves is the settled state on either side.
    await pickGroup(page, 'C/D - 1 lap')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Round 1 Week 3: Urumaze$/)
    await expect(panel(page, 'Speed by surface')).toContainText('225 W')
    await expect(panel(page, 'Speed by surface')).not.toContainText('on Makuri 40')
    await expect(answer(page)).toContainText('of Urumaze in Makuri Islands')
  })

  test('keeps its draft explanation on the Applied rider when a new mode fails', async ({ page }) => {
    await visit(page, `${SCRATCH}?draft=race`)
    await expect(answer(page)).toContainText('/ race drafting;')
    await page.route(url => isListingUrl(url.toString()), route => route.fulfill({
      status: 400, json: { statusCode: 400, message: 'Refresh failed' }
    }))
    await page.getByRole('button', { name: 'Draft mode', exact: true }).click()
    const response = page.waitForResponse(isListingResponse)
    await page.getByRole('option', { name: 'Solo', exact: true }).click()
    expect((await response).status()).toBe(400)
    await ready(page)
    await expect(answer(page)).toContainText('/ race drafting;')
    await expect(page.getByText(/ranking below is computed for a lone rider/)).toHaveCount(0)
  })

  test('shows where the points are as a tab, and stars them on the Course hero', async ({ page }) => {
    await visit(page, RACE_OF_TRUTH)
    await tab(page, 'Scoring').click()
    const scoring = panel(page, 'Scoring')
    await expect(scoring.getByRole('table')).toBeVisible()
    await expect(scoring).toContainText('FAL')
    await expect(scoring).toContainText('FTS')
    // Twice round the Montmartre climb in one lap, in the order they come.
    // In the order they are ridden, which is not the order WTRL publishes them.
    await expect(scoring.getByRole('row')).toContainText([/Segment/, /Lutece/, /Monceau/, /Église/, /Montmartre/, /Tchou Tchou/])
    // The link carries this race's FORMAT, not its identity (#224): a Race of
    // Truth bars TT frames and has no draft, and the segment page honours both
    // off `?rules=` alone, with no idea which race sent the rider.
    await expect(scoring.getByRole('link', { name: /Montmartre FWD Climb/ })).toHaveAttribute('href', '/segments/montmartre-kom?rules=rot')
    await expect(scoring).toContainText('ridden as a Race of Truth too, with TT frames left out of it and no draft')

    // The profile is the hero now, drawn once, with the scoring passes starred on it.
    await expect(tab(page, 'Elevation')).toHaveCount(0)
    await expect(hero(page)).toBeVisible()
    await expect(hero(page)).toContainText('★')
  })

  test('plans the paceline for a team time trial, where TT frames are legal', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:rider-profile', JSON.stringify({ draftMode: 'ttt' })))
    const listing = page.waitForResponse(response => isListingResponse(response) && response.url().includes('draftMode=ttt'))
    await visit(page, TTT)
    const query = new URL((await listing).url()).searchParams
    expect(query.get('excludeTT'), 'Zwift gives TT frames draft in a TTT, so they are legal').toBeNull()

    await expect(rideNotes(page)).toContainText('Zwift enables TT frames')
    await expect(answer(page)).toContainText('TT bikes are allowed in this team time trial.')
    await expect(rideNotes(page)).toContainText(/paceline|sector/i)

    await tab(page, 'TTT plan').click()
    await expect(panel(page, 'TTT plan')).toContainText('rider paceline')
  })

  test('compares setups and reaches the whole catalog from the search box', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers comparison and search')
    await visit(page, SPLIT_BY_LAPS)
    expect(await rows(page).count()).toBeGreaterThanOrEqual(3)
    for (const index of [0, 1]) {
      await rows(page).nth(index).getByRole('button', { name: /^Show details for / }).click()
      await rows(page).nth(index).getByRole('checkbox', { name: /^Compare / }).check()
    }
    const comparison = page.getByRole('region', { name: /Selected setups/ })
    await expect(comparison).toBeVisible()
    await expect(page.getByRole('button', { name: /^Show comparison, 2 of 3/ })).toBeVisible()
    await comparison.getByRole('button', { name: 'Clear comparison' }).click()
    await expect(comparison).toHaveCount(0)

    // A search reaches the eligible catalog, not the rows on screen - and
    // eligibility on this page still excludes every TT frame.
    const { data } = await rerank(page, () => page.getByRole('textbox', { name: 'Search all frames and wheels' }).fill('Zipp'))
    expect(data.combos.length).toBeGreaterThan(0)
    expect(data.combos.every(combo => combo.wheelset?.name.toLowerCase().includes('zipp'))).toBe(true)
    await expect(answer(page)).toContainText('search: Zipp')
  })

  test('says nothing matched, and which control to reach for', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the empty state')
    await visit(page, SPLIT_BY_LAPS)
    await rerank(page, () => page.getByRole('textbox', { name: 'Search all frames and wheels' }).fill('nothing is called this'))
    await expect(page.getByLabel('Recommended setup')).toContainText('No bikes match your filters.')
    await expect(page.getByLabel('Recommended setup')).toContainText('Clear the search')
    await expect(recommendation(page)).toHaveCount(0)
    // The one widening action, where the empty table would be.
    await expect(page.locator('#ride-ranking').getByRole('button', { name: 'Clear the search' })).toBeVisible()
    // The Fact row and the hero read only the Ride, so they are still there with nothing ranked.
    await expect(facts(page)).toBeVisible()
    await expect(hero(page)).toBeVisible()
  })

  test('reproduces a shared view without storing any of it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers shared views')
    const stored = () => page.evaluate(() => ({
      preferences: localStorage.getItem('zwift-bikes:preferences'),
      profile: localStorage.getItem('zwift-bikes:rider-profile')
    }))
    await page.addInitScript(() => {
      localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ bikeCategory: 'standard' }))
      localStorage.setItem('zwift-bikes:rider-profile', JSON.stringify({ draftMode: 'solo' }))
    })
    await visit(page, `${SPLIT_BY_COURSE}?group=1&category=tt&draft=ttt`)

    // The link's group picked the course; TT is not offered here, so the
    // link's category lands as the substitution the ranking actually made.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Round 1 Week 3: Urumaze$/)
    await expect(groupPicker(page)).toHaveText('C/D - 1 lap')
    await expect(page.getByRole('group', { name: 'Rider' })).toContainText('TTT')
    await expect(answer(page)).toContainText('all bike categories')

    expect(await stored(), 'a link someone sent never writes to the rider\'s own settings').toEqual({
      preferences: JSON.stringify({ bikeCategory: 'standard' }),
      profile: JSON.stringify({ draftMode: 'solo' })
    })

    // Restoring the saved draft mode ends the override and re-ranks.
    await rerank(page, () => page.getByRole('button', { name: 'Restore my saved draft mode' }).first().click())
    await expect(page.getByRole('group', { name: 'Rider' })).toContainText('Solo')
    expect(new URL(page.url()).searchParams.get('draft')).toBeNull()
    // The group stays: it is the page's, and it is still what is being ranked.
    expect(new URL(page.url()).searchParams.get('group')).toBe('1')
  })

  test('serves the rules and the answer to a crawler, before any script runs', async ({ page, request }) => {
    await visit(page, SPLIT_BY_COURSE)
    const visible = normalise(await answer(page).locator('p').allInnerTexts().then(lines => lines.join(' ')))
    expect(visible).toMatch(/^TT bikes are disabled for this points race\. Our model puts /)
    expect(normalise((await structuredAnswer(page)) ?? '')).toBe(visible)

    const html = await (await request.get(SPLIT_BY_COURSE)).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        heading: doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim(),
        title: doc.title,
        answer: doc.querySelector('#ride-answer-heading + p')?.textContent,
        canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        segmentLinks: [...doc.querySelectorAll('a[href^="/segments/"]')].map(link => link.getAttribute('href')),
        faq: [...doc.querySelectorAll('script[type="application/ld+json"]')]
          .map(script => JSON.parse(script.textContent ?? '{}'))
          .find(schema => schema['@type'] === 'FAQPage')?.mainEntity[0].acceptedAnswer.text as string | undefined
      }
    }, html)
    expect(served.heading).toBe('The fastest bike for Round 1 Week 3: Makuri 40')
    expect(served.title.toLowerCase()).toContain('fastest bike for')
    expect(served.answer).toMatch(/^TT bikes are disabled for this points race\./)
    expect(served.faq).toMatch(/^TT bikes are disabled for this points race\./)
    expect(served.canonical).toMatch(/\/events\/zrl-2026-27\/round-1-week-3$/)
    // The scoring table is in the HTML, hidden tab or not, so its links are crawlable.
    expect(served.segmentLinks.length).toBeGreaterThan(0)
  })

  test('keeps every destination the organiser and the calendar own', async ({ page }) => {
    await visit(page, SPLIT_BY_COURSE)
    // Back to the calendar this race is listed on.
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Zwift Racing League 2026/27' })).toHaveAttribute('href', '/events/zrl-2026-27')
    // Out to the organiser, who owns signup, the rules and the results.
    const official = page.getByRole('link', { name: 'Official event info' })
    await expect(official).toHaveAttribute('target', '_blank')
    await expect(official).toHaveAttribute('href', /^https?:\/\//)
    await expect(page.getByText(/signup, full rules and results live with WTRL/)).toBeVisible()
    // On to the route outside the event, with the difference spelled out.
    const analysis = page.getByRole('link', { name: 'Fastest bike for Makuri 40', exact: true })
    await expect(analysis).toHaveAttribute('href', '/routes/makuri-40')
    await expect(analysis.locator('..')).toContainText('this race\'s rule is the race\'s, not the route\'s')

    // The breadcrumb trail a crawler walks: home, calendars, season, race.
    expect(await page.evaluate(() => {
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        const schema = JSON.parse(script.textContent ?? '{}')
        if (schema['@type'] === 'BreadcrumbList') return schema.itemListElement.map((item: { name: string }) => item.name)
      }
      return undefined
    })).toEqual(['Home', 'Race calendars', 'Zwift Racing League 2026/27', 'Round 1 Week 3'])
  })

  test('keeps the split-course table and the dark Colour mode inside the viewport', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'dark'))
    await visit(page, SPLIT_BY_COURSE)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d(:\d\d)?$/)
    await expectNoHorizontalOverflow(page)
    await page.getByRole('table', { name: 'Ranked setups' }).scrollIntoViewIfNeeded()
    await expectNoHorizontalOverflow(page)
  })

  test('opens the details drawer from the keyboard and returns focus to the name', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard access is a desktop journey')
    await visit(page, SPLIT_BY_LAPS)
    const name = recommendation(page).getByRole('button', { name: /^Details for / }).first()
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

  test('tells a bike barred by the race that it is illegal, not slow', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the drawer carried across a navigation')
    // A TT frame's drawer, opened where TT frames are legal, carried onto a
    // race that bars them. The drawer outlives a client-side navigation by
    // design, so what it says there has to be true: the bike is missing from
    // that ranking because it is illegal, not because it was beaten.
    //
    // The carry is forward, and driven by the router rather than a gesture:
    // since #239 the back press that used to produce this state closes the
    // drawer instead, and an open Overlay covers every link on the page - so
    // `navigateUnderOverlay` is the only way left to reach the state this
    // attribution was written for.
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ bikeCategory: 'tt' })))
    await visit(page, SPLIT_BY_COURSE)
    await expect(categoryChip(page), 'the race substitutes the stored TT category').toHaveText('All categories')

    // Out to the route the race is run on, where TT frames are legal and,
    // with the stored category, are the whole ranking.
    await page.getByRole('link', { name: 'Fastest bike for Makuri 40', exact: true }).click()
    await ready(page)
    await expect(categoryChip(page)).toHaveText('Time Trial')
    const name = recommendation(page).getByRole('button', { name: /^Details for / }).first()
    const frameName = await name.innerText()
    await name.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(frameName)
    const finishOnTheRoute = await dialog.getByText(/^\d+:\d\d(:\d\d)? ·/).innerText()

    // On to the race, without a reload - the drawer is still open.
    await navigateUnderOverlay(page, SPLIT_BY_COURSE)
    await ready(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('This bike is barred from the ride you are looking at')
    await expect(dialog).not.toContainText('slow enough to rank below every bike shown')
    await expect(dialog).toContainText(frameName)
    // Its own ride's numbers, not a gap measured against a ranking it is not in.
    await expect(dialog.getByText(/^\d+:\d\d(:\d\d)? ·/)).toHaveText(finishOnTheRoute)
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
