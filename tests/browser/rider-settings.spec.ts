import { expect, test, type Page } from '@playwright/test'
import { dragThumb, isListingResponse, isListingUrl, ready, rerank, seedRiderProfile, visit } from './support'

/**
 * Rider settings and Shared views (issue #209): a slider commits on release
 * and nothing else, a sprint ranks at the sprint power the rider saved, the
 * draft controls reach the request, and a value a link supplied lasts for the
 * visit - marked, carried to the next ranking page, restorable - without ever
 * being stored. After every change the rider strip, the visible answer and
 * the FAQ structured data quote the same rider, because all three read the
 * APPLIED rider (see `CONTEXT.md`), never the controls.
 *
 * One journey stubs a recommend response. The rule for this file: a stub is
 * allowed ONLY when the stub itself is the condition under test - here, a
 * failed refetch - never to make a real journey faster or more deterministic.
 * Everything else goes through the dev server's real endpoints.
 *
 * Desktop-only, like the other journeys with no layout question in them, and
 * every wait comes from `support.ts`.
 */

const ROUTE = '/routes/hilly-route'
/** A positional sprint, ranked at sprint power - see the segment journey. */
const SPRINT = '/segments/fuego-flats'
const PROFILE_KEY = 'zwift-bikes:rider-profile'

const strip = (page: Page) => page.getByRole('group', { name: 'Rider' })
const answer = (page: Page) => page.locator('section:has(#ride-answer-heading)')
/** The second line of the answer: the rider values and restrictions the time depends on. */
const assumptions = (page: Page) => answer(page).locator('p.text-xs')
const finishTime = (page: Page) => page.locator('section:has(#ride-recommendation-heading)').locator('p.tabular-nums').first()
const adjustEffort = (page: Page) => page.getByRole('button', { name: 'Adjust effort' })
const slider = (page: Page, name: string) => page.getByRole('slider', { name })
const draftSelect = (page: Page) => page.getByRole('button', { name: 'Draft mode', exact: true })
/** The strip's marker; the slider box has one of its own beside the draft select. */
const restoreDraft = (page: Page) => strip(page).getByRole('button', { name: 'Restore my saved draft mode' })
const controlsRestoreDraft = (page: Page) => page.getByRole('button', { name: 'Restore my saved draft mode' }).nth(1)
const restoreCategory = (page: Page) => page.getByRole('button', { name: 'Restore my saved category' })
const filterSummary = (page: Page) => page.getByText(/^(All categories|Standard \(Road\)|Time Trial|Gravel|Hand Cycle|Fun Bike) \/ (Verified only|Includes estimates)$/)
const haloSwitch = (page: Page) => page.getByRole('switch', { name: 'Include Halo bikes' })
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })
const panel = (page: Page, name: string) => page.getByRole('tabpanel', { name, exact: true })

test.describe('rider settings', () => {
  test.skip(({ isMobile }) => isMobile, 'the desktop journeys cover the controls; none of this is a layout question')

  test('commits a slider on release only, then explains the new time with the value it was computed from', async ({ page }) => {
    await visit(page, ROUTE)
    await expectExplained(page, { strip: ['75 kg', '225 W', 'Solo'], answer: ['75 kg / 175 cm / 225 W / solo'] })
    const requests = countListingRequests(page)
    await adjustEffort(page).click()
    const before = requests()
    const label = page.getByText(/^Rider weight: \d+ kg$/)
    const seen: number[] = []
    const responsePromise = page.waitForResponse(isListingResponse)
    await dragThumb(page, slider(page, 'Rider weight in kilograms'), 60, async () => {
      // Mid-drag: the label follows the thumb as a whole number of kilograms,
      // nothing is requested, and the strip still explains the time on screen
      // with the weight it was computed from.
      seen.push(Number.parseInt((await label.innerText()).replace('Rider weight: ', ''), 10))
      expect(requests()).toBe(before)
      await expect(strip(page)).toContainText('75 kg')
    })
    expect(seen.every(value => Number.isInteger(value) && value >= 40 && value <= 130)).toBe(true)
    expect(new Set(seen).size).toBeGreaterThan(1)

    // Release: one request, for the value the label showed last.
    const response = await responsePromise
    await ready(page)
    expect(requests()).toBe(before + 1)
    const committed = Number(new URL(response.url()).searchParams.get('weightKg'))
    expect(committed).toBe(seen.at(-1))
    expect((await storedProfile(page)).weightKg).toBe(committed)
    const data = await response.json() as { combos: { finishTimeSec: number }[] }
    await expect(finishTime(page)).toHaveText(formatDuration(data.combos[0]!.finishTimeSec))
    await expectExplained(page, { strip: [`${committed} kg`], answer: [`${committed} kg / 175 cm / 225 W / solo`] })
  })

  test('ranks a sprint at the sprint power the rider saved, and the effort slider edits that value alone', async ({ page }) => {
    await seedRiderProfile(page, { weightKg: 80, heightCm: 180, powerW: 250, sprintPowerW: 900 })
    await visit(page, SPRINT)
    await expectExplained(page, { strip: ['80 kg', '900 W', 'sprint'], answer: ['80 kg / 180 cm / 900 W / solo'] })

    await adjustEffort(page).click()
    const { query } = await rerank(page, () => dragThumb(page, slider(page, 'Rider power in watts'), -60))
    const committed = Number(query.get('powerW'))
    expect(committed).toBeLessThan(900)
    const stored = await storedProfile(page)
    expect(stored.sprintPowerW).toBe(committed)
    expect(stored.powerW).toBe(250)
    await expectExplained(page, { strip: [`${committed} W`, 'sprint'], answer: [`80 kg / 180 cm / ${committed} W / solo`] })
  })

  test('rides a TTT paceline with the team size and climb pace the rider sets', async ({ page }) => {
    await visit(page, ROUTE)
    await adjustEffort(page).click()
    await page.getByRole('button', { name: 'Riding this in a group? Add draft' }).click()
    await draftSelect(page).click()
    const { query } = await rerank(page, () => page.getByRole('option', { name: 'TTT paceline' }).click())
    expect(query.get('draftMode')).toBe('ttt')
    expect(query.get('tttRiders')).toBe('8')
    // Untouched, the climb pace is omitted: climbs are ridden at the rider's normal power.
    expect(query.has('tttClimbWkg')).toBe(false)
    expect((await storedProfile(page)).draftMode).toBe('ttt')
    await expectExplained(page, { strip: ['TTT paceline'], answer: ['225 W / TTT paceline (8 riders);'] })
    await expect(tab(page, 'TTT plan')).toBeVisible()

    const team = Number((await rerank(page, () => dragThumb(page, slider(page, 'Number of riders in the paceline'), -40))).query.get('tttRiders'))
    expect(team).toBeLessThan(8)
    const pace = Number((await rerank(page, () => dragThumb(page, slider(page, 'Team average power on long climbs in watts per kilogram'), 30))).query.get('tttClimbWkg'))
    expect(pace).toBeGreaterThan(0)
    await expectExplained(page, { strip: ['TTT paceline'], answer: [`TTT paceline (${team} riders, ${pace.toFixed(1)} W/kg team climb pace);`] })
    // The plan prices its sectors for the same team the answer names.
    await tab(page, 'TTT plan').click()
    await expect(panel(page, 'TTT plan')).toContainText(`${team}-rider paceline, team climb pace ${pace.toFixed(1)} W/kg`)
  })

  test('keeps a link\'s draft mode for the visit - marked, carried to the next page, restorable - and never stores it', async ({ page }) => {
    await seedRiderProfile(page, { weightKg: 80, heightCm: 180, powerW: 250, sprintPowerW: 700, draftMode: 'solo' })
    await visit(page, `${ROUTE}?draft=ttt`)
    const stored = await storedProfile(page)
    expect(stored.draftMode).toBe('solo')
    await expectExplained(page, { strip: ['TTT paceline'], answer: ['250 W / TTT paceline (8 riders);'] })
    await expect(restoreDraft(page)).toBeVisible()

    // An unrelated change during the visit stores nothing of the link's (issue #198).
    await rerank(page, () => haloSwitch(page).click())
    expect(await storedProfile(page)).toEqual(stored)

    // Opening the sliders mounts the profile controls lazily; that used to
    // re-read storage, revert the link's mode and drop it from the URL.
    const requests = countListingRequests(page)
    const count = requests()
    await adjustEffort(page).click()
    await expect(draftSelect(page)).toHaveText('TTT paceline')
    expect(new URL(page.url()).searchParams.get('draft')).toBe('ttt')
    expect(requests()).toBe(count)
    // The slider box marks the link's mode beside its own select - the same
    // control the race page mounts, which has no strip.
    await expect(controlsRestoreDraft(page)).toBeVisible()

    // The profile dialog edits the DEFAULT, so it shows the saved mode, not the link's.
    await strip(page).getByRole('link', { name: 'Edit profile' }).click()
    await expect(page.getByRole('button', { name: 'Default draft mode', exact: true })).toHaveText('Solo')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Default draft mode', exact: true })).toHaveCount(0)

    // The link's value follows the rider to the next ranking page and into
    // that page's URL, so a reload there reproduces it.
    await tab(page, 'Segments').click()
    await panel(page, 'Segments').getByRole('link').first().click()
    await page.waitForURL(/\/segments\/[^?]+\?draft=ttt/)
    await ready(page)
    await expectExplained(page, { strip: ['TTT paceline'], answer: ['TTT paceline (8 riders);'] })
    await visit(page, page.url())
    await expect(restoreDraft(page)).toBeVisible()
    await expectExplained(page, { strip: ['TTT paceline'], answer: ['TTT paceline (8 riders);'] })
    // ...and on to a route again, through the segment's host-route link.
    await page.locator('a[href^="/routes/"]').first().click()
    await page.waitForURL(/\/routes\/[^?]+\?draft=ttt/)
    await ready(page)
    await expectExplained(page, { strip: ['TTT paceline'], answer: ['TTT paceline (8 riders);'] })

    // Restoring drops the link's mode for the saved one: one refetch, a clean
    // URL, and still nothing stored.
    const { query } = await rerank(page, () => restoreDraft(page).click())
    expect(query.has('draftMode')).toBe(false)
    await expect(restoreDraft(page)).toHaveCount(0)
    expect(new URL(page.url()).searchParams.has('draft')).toBe(false)
    await expectExplained(page, { strip: ['Solo'], answer: ['250 W / solo;'] })
    expect(await storedProfile(page)).toEqual(stored)
  })

  test('keeps a link\'s category for the visit, carries it, and restores the saved one on request', async ({ page }) => {
    await visit(page, `${ROUTE}?category=tt`)
    await expect(filterSummary(page)).toHaveText('Time Trial / Verified only')
    await expect(restoreCategory(page)).toBeVisible()
    await expectExplained(page, { strip: [], answer: ['. Time Trial;'] })

    await tab(page, 'Segments').click()
    await panel(page, 'Segments').getByRole('link').first().click()
    await page.waitForURL(/\/segments\/[^?]+\?category=tt/)
    await ready(page)
    await expect(filterSummary(page)).toHaveText('Time Trial / Verified only')
    await visit(page, page.url())
    await expect(filterSummary(page)).toHaveText('Time Trial / Verified only')
    await expect(restoreCategory(page)).toBeVisible()

    const { query } = await rerank(page, () => restoreCategory(page).click())
    expect(query.get('category')).toBe('standard')
    await expect(filterSummary(page)).toHaveText('Standard (Road) / Verified only')
    await expect(restoreCategory(page)).toHaveCount(0)
    expect(new URL(page.url()).searchParams.has('category')).toBe(false)
    await expectExplained(page, { strip: [], answer: ['. Standard (Road);'] })
    // Nothing was ever stored: no control was pressed.
    expect(await page.evaluate(() => localStorage.getItem('zwift-bikes:preferences'))).toBeNull()
  })

  test('applies only the last of rapid slider releases', async ({ page }) => {
    await visit(page, ROUTE)
    await adjustEffort(page).click()
    const thumb = slider(page, 'Rider weight in kilograms')
    const responses: { weightKg: number, finishTimeSec: number }[] = []
    const pending = trackPendingListingRequests(page)
    page.on('response', (response) => {
      if (!isListingResponse(response) || !response.ok()) return
      void response.json().then((data: { combos: { finishTimeSec: number }[] }) => {
        responses.push({ weightKg: Number(new URL(response.url()).searchParams.get('weightKg')), finishTimeSec: data.combos[0]!.finishTimeSec })
      }).catch(() => {})
    })

    // Two releases back to back, the second while the first is still in flight.
    await dragThumb(page, thumb, 40)
    await dragThumb(page, thumb, 40)
    const final = Number(await thumb.getAttribute('aria-valuenow'))
    await expect.poll(pending, { timeout: 60_000 }).toBe(0)
    await ready(page)

    const last = responses.find(response => response.weightKg === final)
    expect(last).toBeTruthy()
    await expect(finishTime(page)).toHaveText(formatDuration(last!.finishTimeSec))
    await expectExplained(page, { strip: [`${final} kg`], answer: [`${final} kg / 175 cm / 225 W / solo`] })
  })

  test('keeps the previous results and says so when a refetch fails, then recovers on the next change', async ({ page }) => {
    await visit(page, ROUTE)
    const time = await finishTime(page).innerText()

    // The one stub in this file - the failure IS the condition under test.
    // Twice, not once: `$fetch` retries a GET that answers 500 one time by
    // itself (ofetch's default), so a single stubbed failure would heal
    // before the page ever saw it.
    await page.route('**/api/recommend/**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 500, message: 'stubbed failure' })
    }), { times: 2 })
    await haloSwitch(page).click()
    // `.first()`: the toast renders its title once for sighted readers and once in a live region.
    await expect(page.getByText('Couldn\'t update the results').first()).toBeVisible()
    await expect(finishTime(page)).toHaveText(time)
    // The applied rider stays with the results it still describes.
    await expectExplained(page, { strip: ['75 kg', '225 W'], answer: ['75 kg / 175 cm / 225 W / solo'] })

    const { data } = await rerank(page, () => haloSwitch(page).click())
    await expect(finishTime(page)).toHaveText(formatDuration(data.combos[0]!.finishTimeSec!))
  })
})

/** Counts recommend listing requests from now on - the way to assert that nothing was requested. */
function countListingRequests(page: Page) {
  let count = 0
  page.on('request', (request) => {
    if (isListingUrl(request.url())) count += 1
  })
  return () => count
}

/** How many recommend listing requests are still in flight, from now on. */
function trackPendingListingRequests(page: Page) {
  let pending = 0
  page.on('request', (request) => {
    if (isListingUrl(request.url())) pending += 1
  })
  const done = (request: { url: () => string }) => {
    if (isListingUrl(request.url())) pending -= 1
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return () => pending
}

/**
 * The strip, the visible answer and the FAQ structured data all describe the
 * rider the times were computed for. `strip` fragments are checked against
 * the strip; `answer` fragments against the visible assumptions line AND the
 * structured answer, which must end with that very line.
 */
async function expectExplained(page: Page, expected: { strip: string[], answer: string[] }) {
  for (const fragment of expected.strip) await expect(strip(page)).toContainText(fragment)
  for (const fragment of expected.answer) await expect(assumptions(page)).toContainText(fragment)
  // Polled, not read once: the head is patched a tick after the DOM, and a
  // client-side navigation leaves the previous page's FAQ in place until then.
  // Resolves to '' once they agree; otherwise both strings, so a failure
  // shows what disagreed.
  await expect.poll(async () => {
    const visible = normalise(await assumptions(page).innerText())
    const structured = normalise(await structuredAnswer(page) ?? '')
    const agree = structured.endsWith(visible) && expected.answer.every(fragment => visible.includes(fragment))
    return agree ? '' : `visible: ${visible}\nstructured: ${structured}`
  }, { message: 'the FAQ structured data ends with the visible assumptions line' }).toBe('')
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

/** What `useRiderProfile` has stored, parsed - where a leaked link value would show up. */
async function storedProfile(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), PROFILE_KEY)
}

/** `formatDuration` as the pages render it - kept in step by the assertions above, not imported, so the spec stays free of app modules. */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}
