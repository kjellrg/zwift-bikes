import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, isListingResponse, ready, rerank, resolvedColor, visitPage } from './support'

/**
 * The garage workflow (issue #214): the same `GarageContent` in its two hosts
 * - the standalone `/garage` page and the Overlay a ranking page opens (see
 * `CONTEXT.md`) - editing one stored garage. What the journeys hold it to:
 * an edit reaches the ranking behind it and survives a reload, each list says
 * which of its four states it is in, and Garage fallback is explained where a
 * rider meets an empty tab rather than left to the ranking to imply.
 *
 * One journey stubs a response. The rule, as in `rider-settings.spec.ts`: a
 * stub is allowed ONLY when the stub itself is the condition under test -
 * here, a catalog fetch that fails - never to make a real journey faster.
 * Everything else goes through the dev server's real endpoints.
 *
 * Both projects run: the garage rows carry the catalog's longest names next
 * to a select, which is a layout question on a phone. Waits come from
 * `support.ts`.
 */

const ROUTE = '/routes/hilly-route'
/** Bot-tested, so its upgrade stage can be set - `useGarage` stores the stage, the select edits it. */
const FRAME = 'Specialized Tarmac SL9'
const WHEEL = 'Roval Alpinist CLX'

const overlay = (page: Page) => page.getByRole('dialog', { name: 'My Garage' })
const editGarage = (page: Page) => page.getByRole('link', { name: 'Edit garage' })
const garageScope = (page: Page) => page.getByText(/Other filters and compatibility still apply\./)
const rows = (page: Page) => page.getByRole('list', { name: 'Ranked setups' }).getByRole('listitem')
/**
 * The same rows read by CSS rather than by role: an open Overlay marks the
 * page behind it `aria-hidden`, and a role query skips what the
 * accessibility tree hides - which is exactly where a journey wants to count
 * the rows the ranking underneath still has.
 */
const rowsBehindOverlay = (page: Page) => page.locator('ol[aria-label="Ranked setups"] > li')
const searchBox = (page: Page) => page.getByRole('textbox', { name: 'Search all frames and wheels' })

const tab = (within: Locator | Page, name: string) => within.getByRole('tab', { name, exact: true })
const bikeSearch = (within: Locator | Page) => within.getByRole('textbox', { name: 'Search bikes' })
const wheelSearch = (within: Locator | Page) => within.getByRole('textbox', { name: 'Search wheels' })
const ownedBikesOnly = (within: Locator | Page) => within.getByRole('switch', { name: 'Only show bikes I own' })
const ownedWheelsOnly = (within: Locator | Page) => within.getByRole('switch', { name: 'Only show wheels I own' })
const ownSwitch = (within: Locator | Page, name: string) => within.getByRole('switch', { name: `Mark ${name} as owned` })
const stageSelect = (within: Locator | Page, name: string) => within.getByRole('button', { name: `Upgrade stage for ${name}` })

test.describe('garage', () => {
  test('reranks the page underneath from the Overlay without losing the rows already loaded', async ({ page }) => {
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await ready(page)
    const nextPage = page.waitForResponse(response => isListingResponse(response) && response.url().includes('offset='))
    await page.getByRole('button', { name: 'Show more matches' }).click()
    expect((await nextPage).ok()).toBe(true)
    await expect.poll(() => rows(page).count()).toBeGreaterThan(0)
    const expanded = await rows(page).count()

    await editGarage(page).click()
    await expect(overlay(page)).toBeVisible()
    await bikeSearch(overlay(page)).fill(FRAME)
    await expect(ownSwitch(overlay(page), FRAME)).toBeVisible()
    // A garage change refreshes what is on screen rather than starting the
    // list over (see `CONTEXT.md`), so the pages already loaded stay loaded.
    await rerank(page, () => ownSwitch(overlay(page), FRAME).click())
    expect(await rowsBehindOverlay(page).count()).toBe(expanded)

    await page.keyboard.press('Escape')
    await expect(overlay(page)).toHaveCount(0)
    await expect(editGarage(page)).toBeFocused()
    // The fallback line exists only under "my garage only": with the switch
    // on, it names which half the frame just added restricts.
    await rerank(page, () => page.getByRole('switch', { name: 'My garage only' }).click())
    await expect(garageScope(page)).toContainText('Your frames / all wheels')
  })

  test('sets a bike\'s stage from its ranked setup, and the garage keeps it', async ({ page }) => {
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await ready(page)
    // The recommendation is rank 1 of the ranking, so the frame may sit
    // there rather than in a row; both carry the same stage control.
    const setup = page.locator('section:has(#ride-recommendation-heading), ol[aria-label="Ranked setups"] > li').filter({ hasText: FRAME }).first()
    await expect(setup).toBeVisible()
    // Not owned: the stage is the profile's default for unowned bikes, as
    // text - there is nothing to edit here until the bike is in the garage.
    await expect(setup.getByText(/^Stage \d, assumed$/)).toBeVisible()
    await expect(stageSelect(setup, FRAME)).toHaveCount(0)

    await rerank(page, () => setup.getByRole('button', { name: `Quick-add ${FRAME} to garage` }).click())
    await expect(setup.getByText(/, assumed$/)).toHaveCount(0)
    // One stage down, not more: unowned bikes are ranked at stage 5, so a
    // bigger drop can push this frame off the first page and take its
    // select with it. The select shows the new stage as soon as it is
    // picked, ahead of the reload, which is when the row is still where the
    // pick was made.
    const reranked = page.waitForResponse(isListingResponse)
    await stageSelect(setup, FRAME).click()
    await page.getByRole('option', { name: 'Stage 4', exact: true }).click()
    await expect(stageSelect(setup, FRAME)).toHaveText('Stage 4')
    const response = await reranked
    expect(response.ok()).toBe(true)
    await ready(page)
    // The stage went into the request the ranking was refetched with.
    expect(Object.values(JSON.parse(new URL(response.url()).searchParams.get('owned') ?? '{}'))).toContain(4)

    await visitPage(page, '/garage')
    await bikeSearch(page).fill(FRAME)
    await expect(ownSwitch(page, FRAME)).toBeChecked()
    await expect(stageSelect(page, FRAME)).toHaveText('Stage 4')
  })

  test('keeps what the page edits, and ranks the frame at the stage it was given', async ({ page }) => {
    await visitPage(page, '/garage')
    await bikeSearch(page).fill(FRAME)
    await expect(ownSwitch(page, FRAME)).toBeVisible()
    await ownSwitch(page, FRAME).click()
    await stageSelect(page, FRAME).click()
    await page.getByRole('option', { name: 'Stage 2', exact: true }).click()
    await expect(stageSelect(page, FRAME)).toHaveText('Stage 2')

    await tab(page, 'Wheels').click()
    await wheelSearch(page).fill(WHEEL)
    await expect(ownSwitch(page, WHEEL)).toBeVisible()
    await ownSwitch(page, WHEEL).click()

    await visitPage(page, '/garage')
    await bikeSearch(page).fill(FRAME)
    await expect(ownSwitch(page, FRAME)).toBeChecked()
    await expect(stageSelect(page, FRAME)).toHaveText('Stage 2')
    await tab(page, 'Wheels').click()
    await wheelSearch(page).fill(WHEEL)
    await expect(ownSwitch(page, WHEEL)).toBeChecked()

    // Both halves owned is the case where "my garage only" restricts both,
    // and the stage the garage stored is the stage the drawer ranks at.
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await expect(garageScope(page)).toHaveCount(0)
    await rerank(page, () => page.getByRole('switch', { name: 'My garage only' }).click())
    await expect(garageScope(page)).toContainText('Your frames / your wheels')

    await rerank(page, () => searchBox(page).fill(FRAME))
    // Wherever the search leaves it in the ranking: with both halves of the
    // garage owned this is often a ranking of one, and rank 1 is the
    // recommendation, not a row (issue #227).
    await page.getByRole('button', { name: `Details for ${FRAME}` }).first().click()
    const drawer = page.getByRole('dialog')
    await expect(drawer.getByRole('button', { name: `Set upgrade stage 2 for ${FRAME}`, pressed: true })).toBeVisible()
  })

  test('says why a tab is empty, in the words of the fallback the ranking will use', async ({ page }) => {
    await visitPage(page, '/garage')
    await ownedBikesOnly(page).click()
    await expect(page.getByText('Your garage is empty, so "my garage only" shows all equipment.')).toBeVisible()
    await tab(page, 'Wheels').click()
    await ownedWheelsOnly(page).click()
    await expect(page.getByText('Your garage is empty, so "my garage only" shows all equipment.')).toBeVisible()

    // With one half owned the other half is a real restriction, and the copy
    // says which one - the same four cases the filters state on a ranking page.
    await tab(page, 'Bikes').click()
    // Back to the whole catalog to find the frame: "only show what I own" is
    // still on from the assertion above, and it is hiding every row.
    await ownedBikesOnly(page).click()
    await expect(ownedBikesOnly(page)).not.toBeChecked()
    await bikeSearch(page).fill(FRAME)
    await expect(ownSwitch(page, FRAME)).toBeVisible()
    await ownSwitch(page, FRAME).click()
    await tab(page, 'Wheels').click()
    await expect(page.getByText('"My garage only" ranks your frames against every wheel until you do.')).toBeVisible()

    await page.getByRole('button', { name: 'Show all wheels' }).click()
    await expect(ownedWheelsOnly(page)).not.toBeChecked()
    await expect(ownSwitch(page, WHEEL)).toBeVisible()
  })

  test('says when the catalog itself failed, and recovers on request', async ({ page }) => {
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await ready(page)
    // The one stub in this file - the failure IS the condition under test.
    // Every attempt is answered rather than a counted few: `$fetch` retries a
    // GET that answers 500 by itself (ofetch's default), so a stub with a
    // count would heal on a retry instead of when this journey says so.
    await page.route('**/api/bikes**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 500, message: 'stubbed failure' })
    }))

    await editGarage(page).click()
    await expect(overlay(page)).toBeVisible()
    await expect(overlay(page).getByText('Couldn\'t load the bike catalog.')).toBeVisible()
    // Not the search's fault, and not an empty garage's: the failure is read
    // ahead of both, because a failed fetch empties the data they read.
    await expect(overlay(page).getByText('No bikes match your search.')).toHaveCount(0)

    await page.unroute('**/api/bikes**')
    await overlay(page).getByRole('button', { name: 'Try again' }).click()
    await expect(overlay(page).getByText('Couldn\'t load the bike catalog.')).toHaveCount(0)
    await expect(ownSwitch(overlay(page), FRAME)).toBeVisible()
  })

  test('blames the search for an empty search, wraps the longest name, and locks a stage nobody measured', async ({ page }) => {
    await visitPage(page, '/garage')
    // The longest name in the catalog is the row that has to wrap rather
    // than push the stage select out through the panel's edge - checked on
    // the whole catalog, before a search narrows it to a chosen name.
    const names = page.locator('p.font-medium.break-words')
    await expect(names.first()).toBeVisible()
    const longest = await longestName(names)
    await expectNoHorizontalOverflow(page)
    expect(await longest.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)

    // Waited on the catalog's own answer rather than on the copy appearing:
    // the search is debounced, and the list says "loading" until the request
    // it debounced into lands.
    const empty = page.waitForResponse(response => response.url().includes('/api/bikes?search=nothing-is-called-this'))
    await bikeSearch(page).fill('nothing-is-called-this')
    expect((await empty).ok()).toBe(true)
    await expect(page.getByText('No bikes match your search.')).toBeVisible()
    await expect(page.getByText('Your garage is empty, so "my garage only" shows all equipment.')).toHaveCount(0)

    // A frame nobody has bot-tested has no per-stage numbers, so its stage
    // cannot be set (see `CONTEXT.md`) - it is offered and disabled, with the
    // reason on the tooltip rather than left to be guessed at.
    const estimated = await estimatedFrame(page)
    await bikeSearch(page).fill(estimated)
    await expect(ownSwitch(page, estimated)).toBeVisible()
    await ownSwitch(page, estimated).click()
    await expect(stageSelect(page, estimated)).toBeDisabled()
    await stageSelect(page, estimated).hover({ force: true })
    // By CSS: the tooltip Reka renders is not exposed as a `tooltip` role to
    // the accessibility tree, so `getByRole` never sees the element that is
    // plainly on screen.
    await expect(page.locator('[role="tooltip"]')).toContainText('no per-stage numbers to apply')
  })

  test('carries a switch to light into both hosts', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the theme; the mobile one covers the width')
    await visitPage(page, '/garage')
    const bodyBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    // A first visit is dark, on the palette's deepest neutral - not merely
    // "whatever `--ui-bg` is": that would hold in light mode too (the lesson
    // `shell.spec.ts` carries).
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    const darkGround = await resolvedColor(page, 'var(--ui-color-neutral-950)')
    expect(await bodyBackground()).toBe(darkGround)

    await page.getByRole('button', { name: 'Switch to light mode' }).click()
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    const lightGround = await bodyBackground()
    expect(lightGround).not.toBe(darkGround)

    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await editGarage(page).click()
    await expect(overlay(page)).toBeVisible()
    expect(await overlay(page).evaluate(element => getComputedStyle(element).backgroundColor)).toBe(lightGround)
  })
})

/** The rendered name that is longest in characters - which row that is moves with the catalog, so it is read off the page. */
async function longestName(names: Locator): Promise<Locator> {
  const texts = await names.allInnerTexts()
  const longest = texts.reduce((best, text) => text.length > best.length ? text : best, '')
  expect(longest.length).toBeGreaterThan(0)
  return names.nth(texts.indexOf(longest))
}

/** A frame the classifier could only estimate, read from the catalog rather than pinned: which frames ZwiftInsider has bot-tested changes. */
async function estimatedFrame(page: Page): Promise<string> {
  const response = await page.request.get('/api/bikes')
  expect(response.ok()).toBe(true)
  const { frames } = await response.json() as { frames: { name: string, confidence: string }[] }
  const estimated = frames.find(frame => frame.confidence === 'estimated')
  expect(estimated, 'the catalog holds a frame with an estimated score').toBeTruthy()
  return estimated!.name
}
