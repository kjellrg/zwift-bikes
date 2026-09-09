import { expect, test, type Page, type Response } from '@playwright/test'

/**
 * The course-analysis tabs under the route and segment pages (issue #207)
 * and the TTT briefing and plan that read one result (issue #208): the
 * Ride-only tabs (elevation, segments in ride order, surface details) that
 * exist with zero matches and through a refresh, the equipment tabs (speed
 * chart, TTT plan) that follow the applied results and say so, honest
 * unavailable states, the panels served in the HTML before any click, and
 * the selected tab surviving a lap refresh and the bike drawer. Waits are
 * for real signals (hydration, a recommend response, the results region
 * leaving its busy state), never sleeps - see `route-recommendation.spec.ts`.
 *
 * Nothing here is committed as a screenshot; Playwright keeps failure
 * artefacts under `test-results/`, which is gitignored.
 */

/** One climb (Zwift KOM) and one sprint (Watopia Sprint) per 9.2 km lap, after a 0.5 km lead-in. */
const HILLY = '/routes/hilly-route'
/** A 4.1 km lap with a 2.8 km lead-in and nothing mapped on it. */
const VOLCANO = '/routes/volcano-circuit'
/** Event-only and unverified: no elevation profile, no surface locations. */
const FLAT_REV = '/routes/flat-route-rev'
/** An HC climb with a measured profile and positioned surfaces. */
const CLIMB = '/segments/alpe-du-zwift'
/** A positional sprint: a profile, but no standing-start speed chart. */
const SPRINT = '/segments/fuego-flats'

/** A recommend listing response - the drill-down behind the wheel list is a different question. */
const isListingResponse = (response: Response) => response.url().includes('/api/recommend/') && !response.url().includes('wheelsForFrame')

async function ready(page: Page) {
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__?: { $nuxt?: { isHydrating?: boolean } } } | null)?.__vue_app__
    return app?.$nuxt?.isHydrating === false
  })
  await expect(page.locator('#ride-results')).toHaveAttribute('aria-busy', 'false')
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect(response?.ok(), `${path} answered ${response?.status()}`).toBe(true)
  await ready(page)
}

/** Runs `action`, waits for the listing response it triggers and for the page to apply it. */
async function rerank(page: Page, action: () => Promise<void>) {
  const responsePromise = page.waitForResponse(isListingResponse)
  await action()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  await ready(page)
  return response.json() as Promise<{ combos: { frame: { name: string }, finishTimeSec?: number }[] }>
}

async function pickLaps(page: Page, label: string) {
  // The lap picker is a `USelectMenu`: its trigger is a button carrying the label.
  await page.getByRole('button', { name: 'Laps' }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Laps' })).toHaveText(label)
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
/** Only the active panel is visible; the others stay mounted but hidden, so a role query finds exactly one. */
const panel = (page: Page, name: string) => page.getByRole('tabpanel', { name, exact: true })
const recommendation = (page: Page) => page.locator('section:has(#ride-recommendation-heading)')
const briefing = (page: Page) => page.getByRole('region', { name: 'Ride briefing' })
const segmentRows = (page: Page) => panel(page, 'Segments').getByRole('list', { name: 'Segments in ride order' }).getByRole('listitem')
const elevationChart = (page: Page) => page.getByLabel('Elevation profile chart')
const speedChart = (page: Page) => page.getByLabel('Average speed by surface segment')

/** The "km 1.4-2.3" range on a segment row, as numbers. */
async function kmRange(row: ReturnType<typeof segmentRows>) {
  const match = (await row.innerText()).match(/km (\d+\.\d)-(\d+\.\d)/)
  expect(match, 'a segment row names its km range').toBeTruthy()
  return [Number(match![1]), Number(match![2])] as const
}

/** The top setup's frame name, read from the recommendation, so a scope line can be checked against it. */
async function topFrameName(page: Page) {
  return (await recommendation(page).getByRole('button', { name: /^Details for / }).first().innerText()).trim()
}

test.describe('course analysis tabs', () => {
  test('serves every panel and the segment links from the server, with elevation showing first', async ({ page, request }) => {
    await visit(page, HILLY)
    for (const name of ['Elevation', 'Segments', 'Speed & surface', 'Surface details']) await expect(tab(page, name)).toBeVisible()
    await expect(tab(page, 'TTT plan')).toHaveCount(0)
    await expect(tab(page, 'Elevation')).toHaveAttribute('aria-selected', 'true')
    await expect(panel(page, 'Elevation')).toContainText('Measured elevation profile; 1 lap, lead-in included once.')
    await expect(elevationChart(page)).toBeVisible()
    // The retired tables are gone; the occurrences live in the Segments tab.
    await expect(page.getByText(/Climbs on this route|Sprints on this route/)).toHaveCount(0)

    // The prerendered HTML, not the hydrated page: what a crawler gets.
    const html = await (await request.get(HILLY)).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const panels = [...doc.querySelectorAll('[role="tabpanel"]')]
      return {
        panels: panels.length,
        hiddenPanels: panels.filter(node => node.hasAttribute('hidden')).length,
        segmentLinks: panels.flatMap(node => [...node.querySelectorAll('a[href^="/segments/"]')].map(link => link.getAttribute('href'))),
        simulated: doc.querySelectorAll('[aria-label="Average speed by surface segment"]').length
      }
    }, html)
    expect(served.panels).toBe(4)
    expect(served.hiddenPanels).toBe(3)
    expect(served.segmentLinks).toEqual(expect.arrayContaining(['/segments/zwift-kom', '/segments/watopia-sprint']))
    // The expensive speed simulation is not run for a page nobody has asked it of.
    expect(served.simulated).toBe(0)
  })

  test('lists climbs and sprints in ride order, once per lap, and keeps the tab through a lap refresh and the drawer', async ({ page }) => {
    await visit(page, HILLY)
    await tab(page, 'Segments').click()
    await expect(panel(page, 'Segments')).toContainText('1 lap; kilometre positions include the lead-in, ridden once.')
    await expect(segmentRows(page)).toHaveCount(2)
    await expect(segmentRows(page).nth(0)).toContainText('Zwift KOM')
    await expect(segmentRows(page).nth(1)).toContainText('Watopia Sprint')
    // Ride positions: the lap's 0.94 km climb start sits after the 0.50 km lead-in.
    const [komFrom, komTo] = await kmRange(segmentRows(page).nth(0))
    expect(komFrom).toBeCloseTo(1.44, 1)
    expect(komTo).toBeCloseTo(2.33, 1)
    await expect(segmentRows(page).nth(0)).not.toContainText('lap 1')
    await expect(segmentRows(page).nth(0).getByRole('link', { name: 'Zwift KOM' })).toHaveAttribute('href', '/segments/zwift-kom')

    await rerank(page, () => pickLaps(page, '2 laps'))
    await expect(tab(page, 'Segments')).toHaveAttribute('aria-selected', 'true')
    await expect(panel(page, 'Segments')).toContainText('2 laps;')
    await expect(segmentRows(page)).toHaveCount(4)
    const names = await segmentRows(page).allInnerTexts()
    expect(names.map(text => text.includes('Zwift KOM') ? 'climb' : 'sprint')).toEqual(['climb', 'sprint', 'climb', 'sprint'])
    expect(names.map(text => text.match(/lap (\d)/)?.[1])).toEqual(['1', '1', '2', '2'])
    const starts = await Promise.all([0, 1, 2, 3].map(async index => (await kmRange(segmentRows(page).nth(index)))[0]))
    for (let index = 1; index < starts.length; index++) expect(starts[index]).toBeGreaterThan(starts[index - 1]!)
    // The second lap repeats the first exactly one lap (9.19 km) later.
    expect(starts[2]! - starts[0]!).toBeCloseTo(9.19, 1)
    expect(starts[3]! - starts[1]!).toBeCloseTo(9.19, 1)

    // The bike drawer opens and closes without touching the remembered tab.
    await recommendation(page).getByRole('button', { name: /^Details for / }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(tab(page, 'Segments')).toHaveAttribute('aria-selected', 'true')
    await expect(segmentRows(page)).toHaveCount(4)
  })

  test('explains a route with nothing mapped', async ({ page }) => {
    await visit(page, VOLCANO)
    await tab(page, 'Segments').click()
    await expect(panel(page, 'Segments')).toContainText('No mapped climbs or sprints on this route.')
    await rerank(page, () => pickLaps(page, '2 laps'))
    await expect(panel(page, 'Segments')).toContainText('2 laps; kilometre positions include the lead-in, ridden once.')
    await expect(panel(page, 'Segments')).toContainText('No mapped climbs or sprints on this route.')
    await tab(page, 'Elevation').click()
    await expect(panel(page, 'Elevation')).toContainText('Measured elevation profile; 2 laps, lead-in included once.')
    await expect(elevationChart(page)).toBeVisible()
  })

  test('names what is missing on a route without a profile or surface locations, and keeps the ride-only tabs', async ({ page }) => {
    await visit(page, FLAT_REV)
    await expect(panel(page, 'Elevation')).toContainText('Elevation profile unavailable; the estimate uses the route\'s distance and climbing totals.')
    await expect(elevationChart(page)).toHaveCount(0)
    await tab(page, 'Speed & surface').click()
    await expect(panel(page, 'Speed & surface')).toContainText('Speed & surface profile unavailable: elevation and surface locations are missing. No curve is inferred from the overall surface mix.')
    await expect(speedChart(page)).toHaveCount(0)
    await tab(page, 'Surface details').click()
    await expect(panel(page, 'Surface details')).toContainText('Surface unverified; road assumed by model')
  })

  test('simulates the speed chart only once its tab is chosen, scoped to the applied setup, and keeps it dimmed through a refresh', async ({ page }) => {
    await visit(page, HILLY)
    const frameName = await topFrameName(page)
    // Mounted but hidden: the expensive part has not run.
    await expect(speedChart(page)).toHaveCount(0)
    await tab(page, 'Speed & surface').click()
    await expect(speedChart(page)).toBeVisible()
    const speed = panel(page, 'Speed & surface')
    await expect(speed).toContainText(`${frameName} /`)
    await expect(speed).toContainText('225 W · Solo · one lap plus the lead-in; the finish estimate covers 1 lap.')
    await expect(speed).toContainText(/\d+\.\d km\/h average over the whole simulated ride/)

    // Hold the lap refetch open: the panel must keep the previous chart, dimmed, until the new results land.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const isListing = (url: URL) => url.pathname.startsWith('/api/recommend/') && !url.search.includes('wheelsForFrame')
    await page.route(isListing, async (route) => {
      await held
      await route.continue()
    })
    await pickLaps(page, '2 laps')
    await expect(speed.getByText('Updating results…')).toBeVisible()
    await expect(speedChart(page)).toBeVisible()
    await expect(page.locator('#ride-results')).toHaveAttribute('aria-busy', 'true')
    // Let the held response through and land before the route handler is removed.
    const applied = page.waitForResponse(isListingResponse)
    release()
    expect((await applied).ok()).toBe(true)
    await page.unroute(isListing)
    await ready(page)
    await expect(speed.getByText('Updating results…')).toHaveCount(0)
    await expect(speed).toContainText('the finish estimate covers 2 laps.')
    await expect(tab(page, 'Speed & surface')).toHaveAttribute('aria-selected', 'true')
  })

  test('keeps the ride-only tabs with zero matches and says the equipment tabs need a ranked setup', async ({ page }) => {
    // Verified-only gravel: a category with no verified equipment, so the ranking is empty.
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ verifiedOnly: true, bikeCategory: 'gravel' })))
    const emptyRanking = page.waitForResponse(response => isListingResponse(response) && response.url().includes('category=gravel'))
    await visit(page, HILLY)
    expect((await emptyRanking).ok()).toBe(true)
    await ready(page)
    await expect(page.getByText('No bikes match your filters.')).toBeVisible()

    await expect(elevationChart(page)).toBeVisible()
    await tab(page, 'Segments').click()
    await expect(segmentRows(page)).toHaveCount(2)
    await tab(page, 'Speed & surface').click()
    await expect(panel(page, 'Speed & surface')).toContainText('The speed & surface profile needs a ranked setup to simulate; it returns with the first match.')
    await expect(speedChart(page)).toHaveCount(0)
    await tab(page, 'Surface details').click()
    await expect(panel(page, 'Surface details')).toContainText('Mapped surfaces; the mix describes one lap.')
    await expect(panel(page, 'Surface details')).toContainText('Cobbles')
  })

  test('gives a climb the speed chart as a standing-start simulation, a sprint none, and neither a Segments tab', async ({ page }) => {
    await visit(page, CLIMB)
    await expect(tab(page, 'Segments')).toHaveCount(0)
    await expect(panel(page, 'Elevation')).toContainText('Measured elevation profile of the timed segment.')
    await expect(elevationChart(page)).toBeVisible()
    await tab(page, 'Speed & surface').click()
    await expect(panel(page, 'Speed & surface')).toContainText('route-style simulation from a standing start, not the timed estimate.')
    await expect(speedChart(page)).toBeVisible()
    await tab(page, 'Surface details').click()
    await expect(panel(page, 'Surface details')).toContainText('the mix describes the timed segment.')

    // The remembered tab is not on a sprint page, so it falls back to Elevation.
    await visit(page, SPRINT)
    await expect(tab(page, 'Speed & surface')).toHaveCount(0)
    await expect(tab(page, 'Segments')).toHaveCount(0)
    await expect(tab(page, 'Elevation')).toHaveAttribute('aria-selected', 'true')
    await expect(elevationChart(page)).toBeVisible()
  })

  test('offers the TTT plan tab under TTT drafting only', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('zwift-bikes:rider-profile', JSON.stringify({ draftMode: 'ttt' })))
    const tttRanking = page.waitForResponse(response => isListingResponse(response) && response.url().includes('draftMode=ttt'))
    await visit(page, HILLY)
    expect((await tttRanking).ok()).toBe(true)
    await ready(page)
    await expect(briefing(page)).toBeVisible()
    await tab(page, 'TTT plan').click()
    const plan = panel(page, 'TTT plan')
    await expect(plan).toContainText(`${await topFrameName(page)} /`)
    await expect(plan).toContainText('225 W · 8-rider paceline · 1 lap, lead-in included once; distances are from the ride start.')
    await expect(plan.getByRole('list', { name: 'TTT sectors' }).or(plan.getByText('No sectors flagged by this model'))).toBeVisible()
  })
})
