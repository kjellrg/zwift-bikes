import { expect, test, type Page } from '@playwright/test'
import { isListingResponse, ready, rerank, visit } from './support'

/**
 * The equipment drawer and the wheel drill-down beside it (issue #206): what
 * an ownership or upgrade-stage change does to an open drawer, how the wheel
 * list behaves when its request fails or is superseded, what an
 * integrated-wheel frame offers instead of a wheel swap, and what the
 * comparison survives. Opening, closing and focus return are the route
 * journey's (`route-recommendation.spec.ts`); the key the route curve is
 * refetched on is a unit (`app/utils/upgradeCurve.test.ts`).
 *
 * Waits come from `support.ts` and are for real signals, never sleeps. The
 * one deliberate delay below is inside a `page.route` handler - it is the
 * slow response being simulated, not a wait for the app.
 */

const ROUTE = '/routes/hilly-route'
/** Zwift's Tron bike: integrated wheels, and free rather than a purchasable Halo frame, so a plain search reaches it. */
const FIXED_WHEEL_FRAME = 'Zwift Concept Z1'

const rows = (page: Page) => page.getByRole('list', { name: 'Ranked setups' }).getByRole('listitem')
const recommendation = (page: Page) => page.locator('section:has(#ride-recommendation-heading)')
const searchBox = (page: Page) => page.getByRole('textbox', { name: 'Search all frames and wheels' })
const drawer = (page: Page) => page.getByRole('dialog')
/** The drawer's own finish estimate, which is the card's number - the drawer never computes one. */
const finishEstimate = (page: Page) => drawer(page).getByRole('term').filter({ hasText: 'Est. finish time' }).locator('+ dd')
/** The route curve's accessible summary carries all six stage gains, so a test can read the curve itself. */
const routeCurve = (page: Page) => drawer(page).getByRole('img', { name: /^On this route:/ })
const routeCurveCaption = (page: Page) => drawer(page).getByText(/^Seconds off /)
/** "now +8.9 · maxed +10.3 s" - the marker that follows the stage the bike is scored at. */
const routeCurveMarker = (page: Page) => drawer(page).locator('div:has(> svg[aria-label^="On this route:"]) span.tabular-nums').first()
const wheelDisclosure = (page: Page) => recommendation(page).getByRole('button', { name: /^Wheel alternatives/ })

const isWheelDrillDown = (url: string) => url.includes('/api/recommend/') && url.includes('wheelsForFrame')
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

test.describe('equipment drawer', () => {
  test('follows an ownership and upgrade-stage change made inside it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the mutation')
    // The route curve is refetched under the changed request, so this journey
    // holds that request open to watch what the chart does meanwhile.
    let slowDrillDown = false
    let drillDownStarted!: () => void
    const drillDown = new Promise<void>((resolve) => {
      drillDownStarted = resolve
    })
    await page.route(url => isWheelDrillDown(url.href), async (route) => {
      if (!slowDrillDown) return route.continue()
      slowDrillDown = false
      drillDownStarted()
      await new Promise(resolve => setTimeout(resolve, 8000))
      return route.continue()
    })

    await visit(page, ROUTE)
    // Entered from a ranked row rather than the recommendation: the row is
    // the path with no card of its own above the fold, and both go through
    // `useComboDetail`.
    const row = rows(page).first()
    const frameName = normalise(await row.getByRole('button', { name: /^Details for / }).innerText())
    await row.getByRole('button', { name: /^Details for / }).click()
    await expect(drawer(page)).toBeVisible()

    const timeAtDefault = await finishEstimate(page).innerText()
    const curveAtDefault = await routeCurve(page).getAttribute('aria-label')
    expect(curveAtDefault).toBeTruthy()

    // Quick-add first: the stage buttons exist for a bike in the garage, and
    // a quick-add lands at the level unowned bikes are already scored at, so
    // this step alone must not move the estimate.
    await rerank(page, () => drawer(page).getByRole('button', { name: 'Add frame to garage' }).click())
    await expect(drawer(page).getByRole('button', { name: 'Frame in your garage' })).toBeVisible()
    await expect(finishEstimate(page)).toHaveText(timeAtDefault)

    // One stage down keeps the bike ranked, so a card syncs the changed
    // request and the curve is refetched under it. The chart must not blank
    // while that runs: the six stage times belong to the bike and the course,
    // so the answer already on screen is still the answer, and flashing the
    // placeholder over every stage press would be the drawer's main
    // interaction stuttering for five route integrations.
    slowDrillDown = true
    const reranked = page.waitForResponse(isListingResponse)
    await drawer(page).getByRole('button', { name: `Set upgrade stage 4 for ${frameName}` }).click()
    await drillDown
    // Sampled without auto-retry, while the refetch is still in flight: the
    // claim is that the chart NEVER blanks, and a retrying assertion would
    // just wait for it to come back and pass either way.
    expect(await routeCurve(page).isVisible()).toBe(true)
    expect(await routeCurve(page).getAttribute('aria-label')).toBe(curveAtDefault)
    expect(await drawer(page).locator('[aria-busy="true"]').count()).toBe(0)
    expect((await reranked).ok()).toBe(true)
    await ready(page)

    // Stage 0 is the just-bought bike, so the marker reads the curve's own
    // zero and the ride gets slower, while the curve itself stays put.
    await rerank(page, () => drawer(page).getByRole('button', { name: `Set upgrade stage 0 for ${frameName}` }).click())
    await expect(drawer(page).getByRole('button', { name: `Set upgrade stage 0 for ${frameName}`, pressed: true })).toBeVisible()
    await expect(routeCurveMarker(page)).toContainText('now +0.0')
    expect(secondsOf(await finishEstimate(page).innerText())).toBeGreaterThan(secondsOf(timeAtDefault))
    expect(await routeCurve(page).getAttribute('aria-label')).toBe(curveAtDefault)

    // Raising it again puts the estimate back where it started.
    await rerank(page, () => drawer(page).getByRole('button', { name: `Set upgrade stage 5 for ${frameName}` }).click())
    await expect(finishEstimate(page)).toHaveText(timeAtDefault)
  })

  test('says so, and refetches, when a stage change drops the bike off every loaded row', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the dropped bike')
    await visit(page, ROUTE)
    // The slowest loaded row: at stage 0 it is behind bikes that were already
    // ahead of it, so it leaves the loaded page and the drawer has no card
    // left to follow.
    const row = rows(page).last()
    const frameName = normalise(await row.getByRole('button', { name: /^Details for / }).innerText())
    await row.getByRole('button', { name: /^Details for / }).click()
    const timeAtDefault = await finishEstimate(page).innerText()

    await rerank(page, () => drawer(page).getByRole('button', { name: 'Add frame to garage' }).click())
    await rerank(page, () => drawer(page).getByRole('button', { name: `Set upgrade stage 0 for ${frameName}` }).click())

    await expect(drawer(page).getByText('This bike has dropped off the results you have loaded')).toBeVisible()
    await expect(rows(page).getByRole('button', { name: `Details for ${frameName}` })).toHaveCount(0)
    // Refetched through the drill-down rather than left on the numbers the
    // card last carried, and the notice says which of the two it is showing.
    await expect(drawer(page)).toContainText('The numbers below are for this stage.')
    expect(secondsOf(await finishEstimate(page).innerText())).toBeGreaterThan(secondsOf(timeAtDefault))
    await expect(routeCurveMarker(page)).toContainText('now +0.0')
  })

  test('reopens on the ride the caption describes after the lap count changes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the lap change')
    // The curve is simulated for the applied ride while the caption beside it
    // renders from live state, so the two must never describe different
    // rides. The drawer is modal and unmounts when it closes, so a lap change
    // is necessarily made with it shut - `upgradeCurveKey` is what keeps that
    // true if either of those ever stops being.
    await visit(page, ROUTE)
    await rows(page).first().getByRole('button', { name: /^Details for / }).click()
    const oneLap = await routeCurve(page).getAttribute('aria-label')
    await expect(routeCurveCaption(page)).not.toContainText('2 laps of')
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()

    await rerank(page, async () => {
      await page.getByRole('button', { name: 'Laps' }).click()
      await page.getByRole('option', { name: '2 laps', exact: true }).click()
    })
    await rows(page).first().getByRole('button', { name: /^Details for / }).click()
    await expect(routeCurveCaption(page)).toContainText('2 laps of')
    // Two laps of the same course is a longer ride, so every stage is worth
    // more of it - the curve moved with the caption.
    expect(await routeCurve(page).getAttribute('aria-label')).not.toBe(oneLap)
    expect(maxedGainOf(await routeCurve(page).getAttribute('aria-label'))).toBeGreaterThan(maxedGainOf(oneLap))
  })

  test('recovers a failed wheel list and never lands a superseded one', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the wheel list')
    const STALE_WHEEL = 'Superseded Wheelset'
    // Driven by phase rather than by a call count: `$fetch` retries a failed
    // GET once on its own, so "the first call" is not "the first failure".
    let phase: 'fail' | 'stale' | 'live' = 'fail'
    let staleRequested!: () => void
    let staleFulfilled!: () => void
    const staleRequest = new Promise<void>((resolve) => {
      staleRequested = resolve
    })
    const staleResponse = new Promise<void>((resolve) => {
      staleFulfilled = resolve
    })

    await page.route(url => isWheelDrillDown(url.href), async (route) => {
      if (phase === 'fail') return route.abort('failed')
      if (phase === 'stale') {
        // Flipped here rather than in the test, so the next drill-down is
        // live no matter how the two requests interleave.
        phase = 'live'
        staleRequested()
        // Fetched for real and then renamed: the shape is the endpoint's own,
        // and only the names mark this answer as the superseded one.
        const response = await route.fetch()
        const body = await response.json()
        for (const combo of body.combos ?? []) if (combo.wheelset) combo.wheelset.name = STALE_WHEEL
        await new Promise(resolve => setTimeout(resolve, 8000))
        await route.fulfill({ response, json: body })
        return staleFulfilled()
      }
      return route.continue()
    })

    await visit(page, ROUTE)
    await wheelDisclosure(page).click()
    const list = recommendation(page).locator('[aria-busy]')
    await expect(list).toContainText('Couldn\'t load the wheel options.')

    // The retry's answer is still in flight when the ranking underneath
    // changes, so by the time it arrives it is for a bike this row no longer
    // shows - the reload that the change triggers is the answer that counts.
    phase = 'stale'
    await list.getByRole('button', { name: 'Try again' }).click()
    await expect(list).toHaveAttribute('aria-busy', 'true')
    await staleRequest
    await rerank(page, () => page.getByRole('switch', { name: 'My garage only' }).click())
    await staleResponse
    await expect(list).toHaveAttribute('aria-busy', 'false')
    await expect(list).not.toContainText(STALE_WHEEL)
    await expect(list).toContainText('Gaps are against the fastest wheels for this frame')

    // The count on the disclosure is the whole compatible pool; the rows are
    // the fastest few of it, and the list says which it is showing.
    const offered = Number(normalise(await wheelDisclosure(page).innerText()).replace(/\D+/g, ''))
    const shown = await list.getByRole('button', { name: /^(Quick-add|Remove) / }).count()
    expect(offered).toBeGreaterThan(1)
    expect(shown).toBeGreaterThan(0)
    if (offered > shown) await expect(list).toContainText(`Fastest ${shown} of ${offered} compatible wheels on this ride.`)
  })

  test('offers no wheel swap on a frame whose wheels are part of it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the integrated-wheel frame')
    await visit(page, ROUTE)
    await rerank(page, () => searchBox(page).fill('Concept'))
    const tron = rows(page).filter({ has: page.getByRole('button', { name: `Details for ${FIXED_WHEEL_FRAME}` }) })
    await expect(tron).toHaveCount(1)

    // The row names the wheels it cannot swap rather than inventing a
    // wheelset, and offers no disclosure to open.
    await expect(tron).toContainText('Fixed disc wheels (not swappable)')
    await expect(tron).toContainText('Fixed disc wheels - no wheel swaps on this frame.')
    await expect(tron.getByRole('button', { name: /^Wheel alternatives/ })).toHaveCount(0)

    await tron.getByRole('button', { name: `Details for ${FIXED_WHEEL_FRAME}` }).click()
    await expect(drawer(page)).toContainText('Fixed disc wheels (not swappable)')
    // Nothing in the drawer treats the wheels as a separate part: no wheel
    // garage action, no wheel column in the ratings, no wheel physics row.
    await expect(drawer(page).getByRole('button', { name: /wheels (in your garage|to garage)/i })).toHaveCount(0)
    await expect(drawer(page).getByRole('columnheader', { name: /wheel/i })).toHaveCount(0)
    await expect(drawer(page).getByRole('cell', { name: 'Wheels', exact: true })).toHaveCount(0)
    await expect(drawer(page).getByRole('cell', { name: 'Frame', exact: true })).toHaveCount(1)
  })

  test('keeps the comparison across a drawer visit and the refetch one triggers', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the comparison')
    await visit(page, ROUTE)
    for (const index of [0, 1]) await rows(page).nth(index).getByRole('checkbox').check()
    const comparison = page.getByRole('region', { name: /Selected setups/ })
    await expect(comparison.getByRole('article')).toHaveCount(2)
    const compared = await comparison.getByRole('article').allInnerTexts()

    await rows(page).nth(0).getByRole('button', { name: /^Details for / }).click()
    await expect(drawer(page)).toBeVisible()
    // A quick-add from inside the drawer reloads every loaded page, which is
    // the refetch most likely to lose picks: the rows re-render and the
    // comparison is held as keys, not as component state.
    await rerank(page, () => drawer(page).getByRole('button', { name: 'Add frame to garage' }).click())
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()

    await expect(comparison.getByRole('article')).toHaveCount(2)
    expect(await comparison.getByRole('article').allInnerTexts()).toEqual(compared)
    for (const index of [0, 1]) await expect(rows(page).nth(index).getByRole('checkbox')).toBeChecked()
  })
})

/** "1:23:45 · 31.2 km/h" or "12:34 · ..." as seconds, so two estimates can be ordered. */
function secondsOf(text: string) {
  const parts = normalise(text).split('·')[0]!.trim().split(':').map(Number)
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/** The stage-5 gain out of a sparkline's summary - the most a full upgrade is worth on this ride. */
function maxedGainOf(summary: string | null) {
  const match = summary?.match(/stage 5 ([+-][\d.]+)/)
  expect(match, `no stage 5 in ${summary}`).toBeTruthy()
  return Number(match![1])
}
