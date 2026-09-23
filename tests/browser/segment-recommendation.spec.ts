import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, isListingResponse, navigateUnderOverlay, ready, rerank, visit } from './support'

/**
 * The segment recommendation journey (issues #203, #257): the same
 * answer-first page as a route, on a climb and on a sprint, with what
 * is specific to a segment - no lap controls or route-only panels, the sprint
 * ranked at the rider's separate sprint power, the timed-segment scope in the
 * answer, host-route navigation, and the missing-data states of a segment
 * whose position on its host route is unknown, and the catalog-wide search
 * from a segment's own ranking. Waits come from `support.ts` and are for real
 * signals, never sleeps.
 *
 * Nothing here is committed as a screenshot; Playwright keeps failure
 * artefacts under `test-results/`, which is gitignored.
 */

/** An HC climb with a measured profile and positioned surfaces, hosted by Road to Sky among others. */
const CLIMB = '/segments/alpe-du-zwift'
/** A positional sprint on a measured host, so it has a profile - and it is ranked at sprint power. */
const SPRINT = '/segments/fuego-flats'
/** A membership-only sprint: no position on any host, so no profile and a borrowed surface mix. */
const UNPLACED = '/segments/acropolis-sprint'

const recommendation = (page: Page) => page.locator('section:has(#ride-recommendation-heading)')
const riderCard = (page: Page) => page.locator('aside:has(#rider-card-heading)')
const rideNotes = (page: Page) => page.getByRole('list', { name: 'About this ride' })
const answer = (page: Page) => page.locator('section:has(#ride-answer-heading)')
const finishTime = (page: Page) => page.locator('#ride-finish-time')
const riderSummary = (page: Page) => page.getByRole('group', { name: 'Rider' })
const rankedTable = (page: Page) => page.getByRole('table', { name: 'Ranked setups' })
const rows = (page: Page) => rankedTable(page).locator('tbody')
/** The frame name of every loaded setup, in rank order - rank 1 is the table's first row. */
const frameNames = async (page: Page) => (await rows(page).getByRole('button', { name: /^Details for / }).allInnerTexts()).map(normalise)
const searchBox = (page: Page) => page.getByRole('textbox', { name: 'Search all frames and wheels' })
/** The page's own selection: the Race format this segment is being ridden under (issue #224). */
const rulesPicker = (page: Page) => page.getByRole('button', { name: 'Ridden as' })
/** The category chip above the table, named for the category it shows. */
const categoryChip = (page: Page) => page.getByRole('button', { name: /^Category: / })

/** Picks a race format and waits for the ranking that format triggers. */
async function pickRules(page: Page, label: string) {
  return rerank(page, async () => {
    await rulesPicker(page).click()
    await page.getByRole('option', { name: label, exact: true }).click()
  })
}

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

test.describe('segment recommendation', () => {
  test('lays a climb out like a route, without lap controls or route-only panels, and links its host routes', async ({ page, isMobile }) => {
    await visit(page, CLIMB)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/fastest bike for\s*Alpe du Zwift/i)
    await expect(page).toHaveTitle(/fastest bike for the Alpe du Zwift climb/i)
    await expect(page.locator('#course-hero')).toBeVisible()
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d(:\d\d)?$/)
    // The answer is on the first screen of a phone.
    if (isMobile) {
      const time = (await finishTime(page).boundingBox())!
      expect(time.y + time.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    }

    const pick = (await recommendation(page).boundingBox())!
    const card = (await riderCard(page).boundingBox())!
    const answerBox = (await answer(page).boundingBox())!
    if (isMobile) {
      expect(pick.y + pick.height).toBeLessThanOrEqual(card.y + 1)
    } else {
      expect(card.x).toBeGreaterThanOrEqual(pick.x + pick.width - 1)
    }
    expect(answerBox.y).toBeGreaterThanOrEqual(Math.max(pick.y + pick.height, card.y + card.height) - 1)
    // The ranking follows the answer and precedes the course section.
    expect(await page.evaluate(() => {
      const ranking = document.querySelector('#ride-ranking')!
      const analysis = document.querySelector('#course-analysis')!
      return Boolean(ranking.compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING)
    })).toBe(true)
    // The table starts at rank 1, which is the answer's setup.
    expect(await rows(page).first().locator('tr').first().innerText()).toMatch(/^01\b/)

    // A segment is ridden once: the Rider card fixes the lap count, and the
    // route-only climbs tab has no place here.
    await expect(page.getByRole('button', { name: 'Laps' })).toHaveCount(0)
    await expect(riderCard(page)).toContainText('A segment is timed once')
    await expect(page.getByRole('tab', { name: 'Climbs and sprints' })).toHaveCount(0)

    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Climb, HC')
    await expect(rideNotes(page)).toContainText('Also on')
    await expect(rideNotes(page).getByRole('link', { name: 'Road to Sky' })).toHaveAttribute('href', '/routes/road-to-sky')
    await expect(page.getByRole('link', { name: 'All segments' })).toHaveAttribute('href', '/segments')
    await expectNoHorizontalOverflow(page)
  })

  test('renders the same segment answer for riders and crawlers, from the server, with the host links', async ({ page, request }) => {
    await visit(page, CLIMB)
    const visible = normalise(await answer(page).locator('p').allInnerTexts().then(lines => lines.join(' ')))
    expect(visible).toMatch(/^Our model puts .+ fastest within the current filters for the Alpe du Zwift climb in Watopia, the best bike for it at \d+:\d\d/)
    expect(visible).toContain('the timed segment, excluding warm-up')
    expect(normalise((await structuredAnswer(page)) ?? '')).toBe(visible)

    // The prerendered HTML, not the hydrated page: what a crawler gets.
    const html = await (await request.get(CLIMB)).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        heading: doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim(),
        title: doc.title,
        answer: doc.querySelector('#ride-answer-heading + p')?.textContent,
        canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        hostLinks: [...doc.querySelectorAll('a[href^="/routes/"]')].map(link => link.getAttribute('href')),
        faq: [...doc.querySelectorAll('script[type="application/ld+json"]')]
          .map(script => JSON.parse(script.textContent ?? '{}'))
          .find(schema => schema['@type'] === 'FAQPage')?.mainEntity[0].acceptedAnswer.text as string | undefined
      }
    }, html)
    expect(served.heading).toBe('The fastest bike for Alpe du Zwift')
    expect(served.title.toLowerCase()).toContain('fastest bike for')
    expect(served.answer).toMatch(/^Our model puts /)
    expect(served.faq).toMatch(/^Our model puts /)
    expect(served.canonical).toMatch(/\/segments\/alpe-du-zwift$/)
    expect(served.hostLinks).toContain('/routes/road-to-sky')
  })

  for (const [kind, path, expectSprint] of [['sprint', SPRINT, true], ['climb', CLIMB, false]] as const) {
    test(`ranks a ${kind} at the power the Rider card shows, once, with no lap count in the request`, async ({ page }) => {
      await visit(page, path)
      const strip = riderSummary(page)
      const powerLine = await strip.getByText(/^\d+ W/).innerText()
      const shownPowerW = Number.parseInt(powerLine)
      expect(shownPowerW).toBeGreaterThan(0)
      // A sprint is ridden at the rider's separate sprint power, and the card says so.
      expect(powerLine.includes('sprint')).toBe(expectSprint)

      // A filter toggle refetches the same ride, which makes the request observable.
      const { query, data } = await rerank(page, () => page.getByRole('switch', { name: 'Include Halo bikes' }).click())
      expect(Number(query.get('powerW'))).toBe(shownPowerW)
      expect(query.has('laps')).toBe(false)
      expect(data.combos[0]?.finishTimeSec).toBeDefined()
      await expect(finishTime(page)).toHaveText(formatDuration(data.combos[0]!.finishTimeSec!))
      await expect(answer(page)).toContainText(`${shownPowerW} W`)
      await expect(answer(page)).toContainText('the timed segment, excluding warm-up')
    })
  }

  test('discloses an unplaced segment\'s missing position beside the time and in the notes, and keeps the ride navigable', async ({ page }) => {
    await visit(page, UNPLACED)
    await expect(finishTime(page)).toHaveText(/^\d+:\d\d$/)
    await expect(recommendation(page)).toContainText('Limited route data: elevation and surface locations unavailable.')
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Sprint')
    await expect(rideNotes(page)).toContainText('The exact position of this segment along its host routes isn\'t in our route data')
    await expect(rideNotes(page).getByRole('link', { name: 'Sugar Cookie' })).toHaveAttribute('href', '/routes/sugar-cookie')
    // Nothing to draw without a profile: the hero is a line saying so. The
    // borrowed surface mix still shows, as a mix.
    await expect(page.locator('#course-hero')).toHaveCount(0)
    await expect(page.locator('#course-hero-unavailable')).toBeVisible()
    await page.getByRole('tab', { name: 'Surfaces' }).click()
    await expect(page.getByRole('tabpanel', { name: 'Surfaces' })).toContainText('Tarmac')
  })

  test('reaches a bike no ranking lists, and puts the ranking back when the search is cleared', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers search')
    await visit(page, CLIMB)
    // The Golden Concept Z1 is the plain one in a gold light scheme - one bike,
    // one measurement - so a ranking only ever lists the other half of the
    // pair. Typing its name is the one way to ask for it.
    expect(await frameNames(page)).not.toContainEqual(expect.stringContaining('Golden'))
    const { query, data } = await rerank(page, () => searchBox(page).fill('golden'))
    expect(data.combos.map(combo => combo.frame.name)).toContain('Zwift Golden Concept Z1')
    expect(query.get('search')).toBe('golden')
    // Somewhere in the ranking - a term this narrow can leave it a ranking of one.
    expect(await frameNames(page)).toContain('Zwift Golden Concept Z1')
    // The term travels as a shared view, so the link shows what the rider sees.
    expect(new URL(page.url()).searchParams.get('bike')).toBe('golden')

    await rerank(page, () => page.getByRole('button', { name: 'Clear search' }).click())
    expect(await frameNames(page)).not.toContainEqual(expect.stringContaining('Golden'))
    expect(new URL(page.url()).searchParams.has('bike')).toBe(false)
    expect(await rows(page).count()).toBeGreaterThan(1)
  })

  test('says when nothing in the catalog matches, and recovers on the next term', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers search')
    await visit(page, CLIMB)
    const { data } = await rerank(page, () => searchBox(page).fill('unobtainium'))
    expect(data.combos).toHaveLength(0)
    await expect(page.getByText('Nothing in the catalog matches "unobtainium" under the current filters.')).toBeVisible()
    await expect(rankedTable(page)).toHaveCount(0)
    // The controls that got the rider here are still the way out.
    await expect(searchBox(page)).toBeEnabled()

    const { data: recovered } = await rerank(page, () => searchBox(page).fill('zwift'))
    expect(recovered.combos.length).toBeGreaterThan(0)
    await expect(rows(page).first()).toBeVisible()
  })

  test('shows more matches from the same segment ranking', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers pagination')
    await visit(page, CLIMB)
    const before = await rows(page).count()
    const nextPage = page.waitForResponse(response => isListingResponse(response) && response.url().includes('offset='))
    await page.getByRole('button', { name: /^Show the next \d+$/ }).click()
    expect((await nextPage).ok()).toBe(true)
    await expect.poll(() => rows(page).count()).toBeGreaterThan(before)
  })

  test('ranks a sprint under a race format it is told, and says so in the same words the race page uses', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the rules control')
    // The rider stores `tt`, which a points race cannot honour - the same
    // substitution a race page makes, now reachable from a segment (#224).
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ bikeCategory: 'tt' })))
    await visit(page, SPRINT)
    await expect(categoryChip(page)).toHaveText('Time Trial')

    // The TT frames on screen right now, so the absence below is the format's
    // doing and not a catalog that never offered them.
    const ttFrames = await frameNames(page)
    expect(ttFrames.length).toBeGreaterThan(0)

    const { query, data } = await pickRules(page, 'Points race')
    expect(query.get('excludeTT')).toBe('true')
    expect(query.get('category'), 'a stored TT category cannot narrow a ride that bars TT frames').toBeNull()
    // The endpoint honours it, not just the page: this is the round trip the
    // segment schema had no parameter for before #224.
    expect(data.combos.length).toBeGreaterThan(0)
    expect(data.combos.map(combo => combo.frame.name).filter(name => ttFrames.includes(name))).toEqual([])
    // The wording is `rideRulesLine`'s, shared with the race page.
    await expect(answer(page)).toContainText('TT bikes are disabled for this points race.')
    await expect(categoryChip(page)).toHaveText('All categories')
    // The selection rides in the link, like a route page's lap count.
    expect(new URL(page.url()).searchParams.get('rules')).toBe('points')
    // And the option is gone from both category levers, never merely
    // disabled, with the reason on the Rider card.
    await categoryChip(page).click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'All categories' })).toBeVisible()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Time Trial' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('combobox', { name: 'Bike category' }).click()
    await expect(page.getByRole('option', { name: 'Time Trial' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(riderCard(page)).toContainText('TT frames are barred when this is ridden as a points race.')

    // Back to no race: the bar and the rules line go with it, and so does the key.
    const { query: cleared } = await pickRules(page, 'Not a race')
    expect(cleared.has('excludeTT')).toBe(false)
    await expect(answer(page)).not.toContainText('TT bikes are disabled')
    expect(new URL(page.url()).searchParams.has('rules')).toBe(false)

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zwift-bikes:preferences') ?? '{}').bikeCategory))
      .toBe('tt')
  })

  test('honours a race format a link arrives with, without storing any of it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the rules control')
    // Exactly the link a race page's scoring table builds. A Race of Truth
    // has no draft either, so the ranking is solo whatever the rider stored.
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:rider-profile', JSON.stringify({ draftMode: 'race' })))
    const listing = page.waitForResponse(response => isListingResponse(response) && response.url().includes('excludeTT=true'))
    await page.goto(`${SPRINT}?rules=rot`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    const query = new URL((await listing).url()).searchParams
    expect(query.has('draftMode'), 'a Race of Truth is ridden solo whatever the rider stored').toBe(false)

    await expect(rulesPicker(page)).toContainText('Race of Truth')
    await expect(answer(page)).toContainText('WTRL bans TT bikes from its Race of Truth')
    await expect(page.getByRole('group', { name: 'Rider' })).toContainText('Solo')
    // Page-local, like a lap count: nothing about it is stored.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zwift-bikes:rider-profile') ?? '{}').draftMode)).toBe('race')
    expect(await page.evaluate(() => localStorage.getItem('zwift-bikes:preferences'))).toBeNull()
  })

  test('drops a race format nobody could have selected, rather than guessing at one', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the rules control')
    await page.goto(`${SPRINT}?rules=handicap`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await expect(rulesPicker(page)).toContainText('Not a race')
    await expect(answer(page)).not.toContainText('TT bikes')
  })

  test('tells a bike a format bars that it is illegal, not slow', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the drawer carried across a navigation')
    // The race page's attribution, now that a segment page can bar frames too
    // (#224). A TT frame's drawer, opened on a segment ridden as no race,
    // carried onto one ridden as a points race: it is missing from that
    // ranking because it is illegal, not because it was beaten.
    //
    // Driven by the router for the same reason the race journey is - an open
    // Overlay covers every control on the page, so no gesture reaches this
    // state, and since #239 the back press that used to closes the drawer.
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ bikeCategory: 'tt' })))
    await visit(page, SPRINT)
    await expect(categoryChip(page)).toHaveText('Time Trial')
    const name = recommendation(page).getByRole('button', { name: /^Details for / }).first()
    const frameName = await name.innerText()
    await name.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(frameName)

    await navigateUnderOverlay(page, `${CLIMB}?rules=points`)
    await ready(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('This bike is barred from the ride you are looking at')
    await expect(dialog).not.toContainText('slow enough to rank below every bike shown')
    await expect(dialog).toContainText(frameName)
  })

  test('answers an unknown segment with a 404, not an empty page', async ({ page, request, isMobile }) => {
    test.skip(isMobile, 'the status code is the same on every viewport')
    expect((await request.get('/segments/not-a-segment')).status()).toBe(404)
    const response = await page.goto('/segments/not-a-segment', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('link', { name: 'All segments' })).toHaveCount(0)
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
