import { expect, test, type Page } from '@playwright/test'
import { rerank, visit } from './support'

/**
 * Equipment eligibility and recovery (issue #205): what the ranking is
 * allowed to contain, whether the rider can see the restriction, and whether
 * they can get out of a dead end. The controls themselves are
 * `RideEquipmentFilters`; the rules they drive live on the server and are
 * unit-tested in `server/utils/recommendPipeline.test.ts` - what only a
 * browser can show is that the rider is told which restriction applies and
 * that every way back out is still clickable while the page is empty.
 *
 * Journeys here are desktop-only: none of them is a layout question, and the
 * dev server is the slow part. Waits come from `support.ts` and are for real
 * signals, never sleeps.
 */

const ROUTE = '/routes/hilly-route'

/**
 * Real ids and keys, because a garage is seeded before the page loads and
 * nothing on screen can supply them yet. They are Zwift's own stable
 * identifiers rather than ranking positions, so nothing here moves with the
 * speed data. A stale one does NOT read as an empty garage - `useGarage`
 * sanitises levels, not ids, so the summary line still says "your frames" -
 * it arrives as a ranking with nothing in it, on the case assertions below.
 */
const TARMAC = { id: 3371227947, name: 'Specialized Tarmac SL9' }
const ROAD_WHEEL = 'Roval Alpinist CLX'
/** Gravel-class, so a standard frame cannot take it - `isWheelsetCompatible`. */
const GRAVEL_WHEEL = 'Zipp ZIPP 303 XPLR SW'

const rankedList = (page: Page) => page.getByRole('list', { name: 'Ranked setups' })
const rows = (page: Page) => rankedList(page).getByRole('listitem')
const recommendation = (page: Page) => page.locator('section:has(#ride-recommendation-heading)')
const garageSwitch = (page: Page) => page.getByRole('switch', { name: 'My garage only' })
const garageScope = (page: Page) => page.getByText(/Other filters and compatibility still apply\./)
const filterSummary = (page: Page) => page.getByText(/^(All categories|Standard \(Road\)|Time Trial|Gravel|Hand Cycle|Fun Bike) \/ (Verified only|Includes estimates)$/)
const noMatches = (page: Page) => page.getByText('No bikes match your filters.')
/** The "a bike your filters are hiding is faster" line, which an empty ranking gets too (issue #221). */
const fastestOverall = (page: Page) => page.locator('div').filter({ hasText: /^Fastest overall:/ }).last()
const haloSwitch = (page: Page) => page.getByRole('switch', { name: 'Include Halo bikes' })

interface Garage { frames?: Record<number, number>, wheels?: string[] }

/**
 * Seeds preferences and garage before the page's own `onMounted` reads them.
 * Every key is written on every call, so a second seed in the same test
 * replaces the first rather than merging with it.
 */
async function seed(page: Page, preferences: Record<string, unknown>, garage: Garage = {}) {
  const state = {
    preferences,
    frames: garage.frames ?? {},
    wheels: Object.fromEntries((garage.wheels ?? []).map(key => [key, true]))
  }
  await page.addInitScript((state) => {
    localStorage.setItem('zwift-bikes:preferences', JSON.stringify(state.preferences))
    localStorage.setItem('zwift-bikes:garage', JSON.stringify(state.frames))
    localStorage.setItem('zwift-bikes:garage-wheels', JSON.stringify(state.wheels))
  }, state)
}

test.describe('equipment eligibility', () => {
  test('says which of the four garage cases the ranking is under', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the garage summary')

    // Nothing owned: the switch is on and restricting nothing, which is the
    // case a rider is most likely to misread as "these are my bikes".
    await seed(page, { myBikesOnly: true })
    await visit(page, ROUTE)
    await expect(garageScope(page)).toContainText('Garage empty - showing all equipment')

    await seed(page, { myBikesOnly: true }, { frames: { [TARMAC.id]: 3 } })
    await visit(page, ROUTE)
    await expect(garageScope(page)).toContainText('Your frames / all wheels')
    // The line is describing a real pool, not just reading the garage back.
    // The wheel half of the fallback is not visible as extra rows: a ranking
    // page asks for one row per frame (`maxWheelsetsPerFrame: 1`), so the
    // every-compatible-wheel half shows up inside the row's own wheel
    // disclosure - it is pinned in the unit mirror of this case instead.
    expect(await frameNames(page)).toEqual([TARMAC.name])
    // A ranking of one: the recommendation is the whole of it, and the
    // section beneath says so rather than vanishing (issue #227).
    await expect(rows(page)).toHaveCount(0)
    await expect(page.getByText('Nothing else matches under the current filters.')).toBeVisible()

    await seed(page, { myBikesOnly: true }, { wheels: [ROAD_WHEEL] })
    await visit(page, ROUTE)
    await expect(garageScope(page)).toContainText('All frames / your wheels')
    expect(new Set(await frameNames(page)).size).toBeGreaterThan(1)
    // The one owned wheel is what the ranked frames are on. Not asserted row
    // by row: a fixed-wheel frame has no wheel to name and stays eligible
    // regardless of the garage, which the unit mirror of this case pins.
    await expect(rankedList(page)).toContainText(ROAD_WHEEL)

    await seed(page, { myBikesOnly: true }, { frames: { [TARMAC.id]: 3 }, wheels: [ROAD_WHEEL] })
    await visit(page, ROUTE)
    await expect(garageScope(page)).toContainText('Your frames / your wheels')
    expect(await frameNames(page)).toEqual([TARMAC.name])
    await expect(rows(page)).toHaveCount(0)
    // The only pairing this garage can make.
    await expect(recommendation(page)).toContainText(ROAD_WHEEL)

    // The switch off says nothing at all - there is no restriction to explain.
    await rerank(page, () => garageSwitch(page).click())
    await expect(garageScope(page)).toHaveCount(0)
  })

  test('narrows the ranking to a bike added from the results, without leaving the page', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the quick-add')
    // The seeded garages above are only worth trusting if the way a rider
    // actually fills one produces the same thing, so this journey adds a bike
    // through the results card and watches the same summary line move.
    await seed(page, { myBikesOnly: true })
    await visit(page, ROUTE)
    await expect(garageScope(page)).toContainText('Garage empty - showing all equipment')
    const recommended = (await frameNames(page))[0]
    expect(recommended).toBeTruthy()

    await rerank(page, () => recommendation(page).getByRole('button', { name: /^Quick-add .* to garage$/ }).click())
    await expect(garageScope(page)).toContainText('Your frames / all wheels')
    await expect(recommendation(page).getByRole('button', { name: /^Remove .* from garage$/ })).toBeVisible()
    expect(new Set(await frameNames(page))).toEqual(new Set([recommended]))
  })

  test('recovers a garage whose only wheels cannot fit its frames', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the incompatible garage')
    // A road frame and a gravel wheel is a garage Zwift itself would not let
    // the rider pair, so no filter is too narrow - the combination is empty.
    // `verifiedOnly` off deliberately: no off-road wheel is measured, and the
    // verified filter would otherwise empty the page for its own reasons.
    await seed(page, { myBikesOnly: true, verifiedOnly: false }, { frames: { [TARMAC.id]: 3 }, wheels: [GRAVEL_WHEEL] })
    await visit(page, ROUTE)
    await expect(noMatches(page)).toBeVisible()
    await expect(garageScope(page)).toContainText('Your frames / your wheels')

    // Everything that could get the rider out is still on the page and usable.
    await expect(garageSwitch(page)).toBeEnabled()
    await expect(page.getByRole('link', { name: 'Edit garage' })).toBeVisible()

    // No fastest-overall line here, and rightly so: the garage is what emptied
    // the page, and the category filter is hiding nothing the garage allows.
    await expect(fastestOverall(page)).toHaveCount(0)

    const { data } = await rerank(page, () => garageSwitch(page).click())
    expect(data.combos.length).toBeGreaterThan(0)
    await expect(noMatches(page)).toHaveCount(0)
    await expect(rows(page).first()).toBeVisible()
  })

  test('names the bike a category filter is hiding even with nothing ranked, and reveals it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the empty-page disclosure')
    // Verified gravel again, this time for what the empty page SAYS: the
    // restriction is a display filter, so the answer the rider came for exists
    // and is one click away - it used to be withheld exactly here (issue #221).
    await seed(page, { verifiedOnly: true, bikeCategory: 'gravel' })
    await visit(page, ROUTE)
    await expect(noMatches(page)).toBeVisible()
    await expect(fastestOverall(page)).toBeVisible()
    // The frame is named, and with no ranked setup to measure against the line
    // says it is out of view rather than inventing a gap.
    await expect(fastestOverall(page)).toContainText('not shown under your current filters')
    await expect(fastestOverall(page)).not.toContainText('quicker')

    const { data, query } = await rerank(page, () => page.getByText('Show all categories').click())
    expect(query.has('category')).toBe(false)
    expect(data.combos.length).toBeGreaterThan(0)
    await expect(noMatches(page)).toHaveCount(0)
    await expect(rows(page).first()).toBeVisible()
  })

  test('keeps a reveal the rider pressed, and forgets a category a link carried', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the reveal actions')
    await visit(page, ROUTE)
    // The default category hides the faster TT bike, and says so.
    await expect(filterSummary(page)).toHaveText('Standard (Road) / Verified only')
    const note = page.getByText('Fastest overall:')
    await expect(note).toBeVisible()

    // Only this reveal is reachable: the note's other action appears when a
    // purchasable Halo bike is the fastest overall, and none of the three is
    // - not on any route in the catalog, at any rider profile. Pressing it
    // would need a stubbed response, which would test the stub.
    const { query } = await rerank(page, () => page.getByText('Show all categories').click())
    expect(query.has('category')).toBe(false)
    await expect(filterSummary(page)).toHaveText('All categories / Verified only')

    // A rider pressing a control is a preference: it survives a visit that
    // carries no query at all. (The press wrote `?category=all` into the URL
    // as a shared view; this reload deliberately drops it.)
    await visit(page, ROUTE)
    await expect(filterSummary(page)).toHaveText('All categories / Verified only')
    await expect(note).toHaveCount(0)

    // A link is the other half of that contract: it shows the sender's view
    // for the visit and leaves the rider's own saved category alone - also
    // when something unrelated is stored during the visit. The next persist
    // used to write the link's category along with it (issue #198), so the
    // whole stored object is compared, not just the field the link carried.
    const before = await storedPreferences(page)
    await visit(page, `${ROUTE}?category=tt`)
    await expect(filterSummary(page)).toHaveText('Time Trial / Verified only')
    await rerank(page, () => haloSwitch(page).click())
    expect(await storedPreferences(page)).toEqual({ ...before, includeHaloBikes: true })
    await visit(page, ROUTE)
    await expect(filterSummary(page)).toHaveText('All categories / Verified only')

    // Choosing a category through the control during a link visit is still
    // the rider's own choice, and is stored like any other.
    await visit(page, `${ROUTE}?category=tt`)
    await page.getByRole('button', { name: 'More filters' }).click()
    await page.getByRole('combobox', { name: 'Bike category' }).click()
    await rerank(page, () => page.getByRole('option', { name: 'Standard (Road)' }).click())
    expect((await storedPreferences(page)).bikeCategory).toBe('standard')
    await visit(page, ROUTE)
    await expect(filterSummary(page)).toHaveText('Standard (Road) / Verified only')
  })

  test('leaves the filters usable when a verified category has nothing in it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the empty-category recovery')
    // Verified gravel is the established empty case: no gravel wheel has
    // ZwiftInsider bot-test data, so "verified only" leaves the category with
    // nothing to rank.
    await seed(page, { verifiedOnly: true, bikeCategory: 'gravel' })
    await visit(page, ROUTE)
    await expect(noMatches(page)).toBeVisible()
    await expect(filterSummary(page)).toHaveText('Gravel / Verified only')

    await page.getByRole('button', { name: 'More filters' }).click()
    const verifiedSwitch = page.getByRole('switch', { name: 'Verified frames and wheels only' })
    await expect(verifiedSwitch).toBeEnabled()
    const { data } = await rerank(page, () => verifiedSwitch.click())
    expect(data.combos.length).toBeGreaterThan(0)
    await expect(noMatches(page)).toHaveCount(0)
    await expect(filterSummary(page)).toHaveText('Gravel / Includes estimates')
  })
})

/** What `usePreferences` has stored, parsed - the one place a leaked link value would show up. */
async function storedPreferences(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('zwift-bikes:preferences') ?? '{}'))
}

/**
 * The frame name of every loaded setup, in rank order: the recommendation is
 * rank 1 (issue #227) and the rows continue from rank 2, so the pool a filter
 * left behind is only visible in the two of them together.
 */
async function frameNames(page: Page) {
  const names = [
    ...await recommendation(page).getByRole('button', { name: /^Details for / }).allInnerTexts(),
    ...await rows(page).getByRole('button', { name: /^Details for / }).allInnerTexts()
  ]
  return names.map(name => name.replace(/\s+/g, ' ').trim())
}
