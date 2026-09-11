import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, isListingResponse, isListingUrl, ready, rerank, visit } from './support'

/**
 * The race recommendation journey (issue #217): a race page built from the
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
const briefing = (page: Page) => page.getByRole('region', { name: 'Ride briefing' })
const answer = (page: Page) => page.locator('section:has(#ride-answer-heading)')
const finishTime = (page: Page) => recommendation(page).locator('p.tabular-nums').first()
const rows = (page: Page) => page.getByRole('list', { name: 'Ranked setups' }).getByRole('listitem')
const groupPicker = (page: Page) => page.getByRole('button', { name: 'Your race group' })
const totalDistance = (page: Page) => page.getByText('Total distance').locator('..').locator('dd')
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
/** The two values the equipment filters always show beside "More filters". */
const filterSummary = (page: Page) => page.getByText(/^(All categories|Standard \(Road\)|Time Trial|Gravel|Hand Cycle|Fun Bike) \/ (Verified only|Includes estimates)$/)
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
  test('puts the recommendation beside the briefing on desktop and first on mobile, with the answer beneath both', async ({ page, isMobile }) => {
    await visit(page, SPLIT_BY_COURSE)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Round 1 Week 3: Makuri 40')
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d(:\d\d)?$/)

    const pick = await recommendation(page).boundingBox()
    const brief = await briefing(page).boundingBox()
    const answerBox = await answer(page).boundingBox()
    expect(pick && brief && answerBox).toBeTruthy()
    if (isMobile) {
      // Recommendation first in source order (a screen reader's order) and above the briefing.
      expect(await page.evaluate(() => {
        const rec = document.querySelector('#ride-recommendation-heading')!
        const brief = document.querySelector('#ride-briefing-heading')!
        return Boolean(rec.compareDocumentPosition(brief) & Node.DOCUMENT_POSITION_FOLLOWING)
      })).toBe(true)
      expect(pick!.y + pick!.height).toBeLessThanOrEqual(brief!.y + 1)
    } else {
      expect(pick!.x).toBeGreaterThanOrEqual(brief!.x + brief!.width - 1)
      expect(pick!.width).toBeGreaterThan(brief!.width)
    }
    expect(answerBox!.y).toBeGreaterThanOrEqual(Math.max(pick!.y + pick!.height, brief!.y + brief!.height) - 1)
    // The ranking follows the answer and precedes the course analysis: it is
    // the rest of what the recommendation is rank 1 of (issue #227).
    expect(await page.evaluate(() => {
      const ranking = document.querySelector('#ride-ranking')!
      const analysis = document.querySelector('#course-analysis')!
      return Boolean(ranking.compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING)
    })).toBe(true)
    // Rank 1 is the recommendation on this page too, so the rows pick the
    // ranking up at 02.
    expect(await page.getByRole('list', { name: 'Ranked setups' }).getByRole('listitem').first().innerText()).toMatch(/^02\b/)
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

    await expect(page.getByText('TT bikes are disabled for this race')).toBeVisible()
    await expect(answer(page)).toContainText('TT bikes are disabled for this scratch race.')
    await expect(filterSummary(page)).toHaveText('All categories / Verified only')

    // The option itself is gone: a filter must not offer a category the
    // ranking below would refuse to show.
    await page.getByRole('button', { name: 'More filters' }).click()
    await page.getByRole('combobox', { name: 'Bike category' }).click()
    await expect(page.getByRole('option', { name: 'All categories' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Time Trial' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zwift-bikes:preferences') ?? '{}').bikeCategory))
      .toBe('tt')
  })

  test('rides a Race of Truth solo, with the draft controls gone rather than lying', async ({ page }) => {
    // A stored race-draft profile the race cannot honour: the ranking is made
    // solo, and the controls that would change it are hidden, not disabled.
    // No request goes out at all - solo is what the page was prerendered with,
    // so the substitution lands on the payload the page already has.
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:rider-profile', JSON.stringify({ draftMode: 'race' })))
    let ranked = 0
    page.on('response', response => void (isListingResponse(response) && (ranked += 1)))
    await visit(page, RACE_OF_TRUTH)
    expect(ranked, 'the stored mode is substituted, not fetched around').toBe(0)
    await expect(answer(page)).toContainText('/ solo;')

    const solo = page.getByText('Drafting is disabled in this race')
    await expect(solo).toBeVisible()
    // A rule, not a nudge: there is nothing to dismiss and nothing to switch to.
    await expect(solo.locator('..').getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Rider' })).toContainText('Solo')
    await expect(page.getByRole('button', { name: /draft mode/i })).toHaveCount(0)

    // The slider box opens with no draft cluster in it at all: a live-looking
    // control that changed nothing would be a lie about the times below.
    await page.getByRole('button', { name: 'Adjust effort' }).click()
    await expect(page.getByRole('slider').first()).toBeVisible()
    await expect(page.getByText(/Draft mode|paceline|Riders in your team/)).toHaveCount(0)

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zwift-bikes:rider-profile') ?? '{}').draftMode))
      .toBe('race')
  })

  test('moves the stats, the briefing and the ranking together when the group changes the lap count', async ({ page }) => {
    await visit(page, SPLIT_BY_LAPS)
    await expect(groupPicker(page)).toHaveText('A/B - 4 laps')
    const fourLapDistance = Number.parseFloat(await totalDistance(page).innerText())
    await expect(briefing(page)).toContainText('4 laps')

    const { data, query } = await pickGroup(page, 'C/D - 3 laps')
    expect(query.get('laps')).toBe('3')
    const threeLapDistance = Number.parseFloat(await totalDistance(page).innerText())
    expect(threeLapDistance).toBeLessThan(fourLapDistance)
    await expect(briefing(page)).toContainText('3 laps')
    await expect(answer(page)).toContainText('3 laps, including any lead-in once')
    expect(data.combos[0]?.finishTimeSec).toBeDefined()
    await expect(finishTime(page)).toHaveText(formatDuration(data.combos[0]!.finishTimeSec!))
    expect(new URL(page.url()).searchParams.get('group')).toBe('1')
  })

  test('never pairs one group\'s course with another group\'s ranking', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the applied-course discipline')
    await visit(page, SPLIT_BY_COURSE)
    await tab(page, 'Speed & surface').click()
    await expect(panel(page, 'Speed & surface')).toContainText('225 W')
    // Settled on one course, nothing needs naming a second one.
    await expect(panel(page, 'Speed & surface')).not.toContainText('Urumaze')

    // Hold the ranking for the new group so the window the old page got wrong
    // is open long enough to look at: the selector and the route lookup have
    // moved, the ranking has not.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(url => isListingUrl(url.toString()), async (route) => {
      await held
      await route.continue()
    }, { times: 1 })

    const settled = page.waitForResponse(isListingResponse)
    await groupPicker(page).click()
    await page.getByRole('option', { name: 'C/D - 1 lap' }).click()

    // The header follows the selector immediately - that is the point of it.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Round 1 Week 3: Urumaze')
    // The chart does not: it still describes the combo that was ranked on
    // Makuri 40, and says which course that was.
    await expect(panel(page, 'Speed & surface')).toContainText('on Makuri 40')
    await expect(page.locator('#ride-results')).toHaveAttribute('aria-busy', 'true')

    release()
    expect((await settled).ok()).toBe(true)
    await ready(page)
    // Settled on the new course, and back to naming none.
    await expect(panel(page, 'Speed & surface')).not.toContainText('on Makuri 40')
    await expect(answer(page)).toContainText('of Urumaze in Makuri Islands')
  })

  test('shows where the points are as a tab beside the profile they are starred on', async ({ page }) => {
    await visit(page, RACE_OF_TRUTH)
    await tab(page, 'Scoring').click()
    const scoring = panel(page, 'Scoring')
    await expect(scoring.getByRole('table')).toBeVisible()
    await expect(scoring).toContainText('FAL')
    await expect(scoring).toContainText('FTS')
    // Twice round the Montmartre climb in one lap, in the order they come.
    // In the order they are ridden, which is not the order WTRL publishes them.
    await expect(scoring.getByRole('row')).toContainText([/Segment/, /Lutece/, /Monceau/, /Église/, /Montmartre/, /Tchou Tchou/])
    await expect(scoring.getByRole('link', { name: 'Montmartre FWD Climb' })).toHaveAttribute('href', '/segments/montmartre-kom')
    // A segment page cannot express this race's TT rule (#224), so the link says so.
    await expect(scoring).toContainText('This race\'s TT-frame rule is not applied there')

    await tab(page, 'Elevation').click()
    await expect(panel(page, 'Elevation').getByLabel('Elevation profile chart')).toBeVisible()
  })

  test('plans the paceline for a team time trial, where TT frames are legal', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:rider-profile', JSON.stringify({ draftMode: 'ttt' })))
    const listing = page.waitForResponse(response => isListingResponse(response) && response.url().includes('draftMode=ttt'))
    await visit(page, TTT)
    const query = new URL((await listing).url()).searchParams
    expect(query.get('excludeTT'), 'Zwift gives TT frames draft in a TTT, so they are legal').toBeNull()

    await expect(page.getByText('TT bikes are allowed in this race')).toBeVisible()
    await expect(answer(page)).toContainText('TT bikes are allowed in this team time trial.')
    await expect(briefing(page)).toContainText(/paceline|sector/i)

    await tab(page, 'TTT plan').click()
    await expect(panel(page, 'TTT plan')).toContainText('rider paceline')
  })

  test('compares setups and reaches the whole catalog from the search box', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers comparison and search')
    await visit(page, SPLIT_BY_LAPS)
    expect(await rows(page).count()).toBeGreaterThanOrEqual(3)
    for (const index of [0, 1]) await rows(page).nth(index).getByRole('checkbox').check()
    const comparison = page.getByRole('region', { name: /Selected setups/ })
    await expect(comparison.getByRole('article')).toHaveCount(2)
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
    await expect(page.getByLabel('Recommended setup')).toContainText('Clear the search below')
    await expect(recommendation(page)).toHaveCount(0)
    // The briefing reads only the Ride, so it is still there with nothing ranked.
    await expect(briefing(page)).toBeVisible()
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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Round 1 Week 3: Urumaze')
    await expect(groupPicker(page)).toHaveText('C/D - 1 lap')
    await expect(page.getByRole('group', { name: 'Rider' })).toContainText('TTT')
    await expect(answer(page)).toContainText('all bike categories')

    expect(await stored(), 'a link someone sent never writes to the rider\'s own settings').toEqual({
      preferences: JSON.stringify({ bikeCategory: 'standard' }),
      profile: JSON.stringify({ draftMode: 'solo' })
    })

    // Restoring the saved draft mode ends the override and re-ranks.
    await rerank(page, () => page.getByRole('button', { name: 'Restore my saved draft mode' }).click())
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
        heading: doc.querySelector('h1')?.textContent?.trim(),
        answer: doc.querySelector('#ride-answer-heading + p')?.textContent,
        canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        segmentLinks: [...doc.querySelectorAll('a[href^="/segments/"]')].map(link => link.getAttribute('href')),
        faq: [...doc.querySelectorAll('script[type="application/ld+json"]')]
          .map(script => JSON.parse(script.textContent ?? '{}'))
          .find(schema => schema['@type'] === 'FAQPage')?.mainEntity[0].acceptedAnswer.text as string | undefined
      }
    }, html)
    expect(served.heading).toBe('Round 1 Week 3: Makuri 40')
    expect(served.answer).toMatch(/^TT bikes are disabled for this points race\./)
    expect(served.faq).toMatch(/^TT bikes are disabled for this points race\./)
    expect(served.canonical).toMatch(/\/events\/zrl-2026-27\/round-1-week-3$/)
    // The scoring table is in the HTML, hidden tab or not, so its links are crawlable.
    expect(served.segmentLinks.length).toBeGreaterThan(0)
  })

  test('keeps every destination the organiser and the calendar own', async ({ page }) => {
    await visit(page, SPLIT_BY_COURSE)
    // Back to the calendar this race is listed on.
    await expect(page.getByRole('link', { name: 'Zwift Racing League 2026/27 schedule' })).toHaveAttribute('href', '/events/zrl-2026-27')
    // Out to the organiser, who owns signup, the rules and the results.
    const official = page.getByRole('link', { name: 'Official event info' })
    await expect(official).toHaveAttribute('target', '_blank')
    await expect(official).toHaveAttribute('href', /^https?:\/\//)
    await expect(page.getByText(/signup, full rules and results live with WTRL/)).toBeVisible()
    // On to the route outside the event, with the difference spelled out.
    const analysis = page.getByRole('link', { name: /See the full Makuri 40 route analysis/ })
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

  test('keeps the split-course table and the dark theme inside the viewport', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'dark'))
    await visit(page, SPLIT_BY_COURSE)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d(:\d\d)?$/)
    await expectNoHorizontalOverflow(page)
    await page.getByRole('list', { name: 'Ranked setups' }).scrollIntoViewIfNeeded()
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
    // A TT frame's drawer, opened where TT frames are legal, carried back onto
    // a race that bars them. The drawer outlives a client-side navigation by
    // design - whether it should is #218's call - so what it says there has to
    // be true: the bike is missing from that ranking because it is illegal,
    // not because it was beaten.
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ bikeCategory: 'tt' })))
    await visit(page, SPLIT_BY_COURSE)
    await expect(filterSummary(page), 'the race substitutes the stored TT category').toHaveText('All categories / Verified only')

    // Out to the route the race is run on, where TT frames are legal and,
    // with the stored category, are the whole ranking.
    await page.getByRole('link', { name: /See the full .* route analysis/ }).click()
    await ready(page)
    await expect(filterSummary(page)).toHaveText('Time Trial / Verified only')
    const name = recommendation(page).getByRole('button', { name: /^Details for / }).first()
    const frameName = await name.innerText()
    await name.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(frameName)
    const finishOnTheRoute = await dialog.getByText(/^\d+:\d\d(:\d\d)? ·/).innerText()

    // Back to the race, without a reload - the drawer is still open.
    await page.goBack()
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
