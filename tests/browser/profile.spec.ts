import { expect, test, type Page } from '@playwright/test'
import { dragThumb, expectNoHorizontalOverflow, hydrated, ready, rerank, visitPage } from './support'

/**
 * The rider profile workflow (issue #213): the same `ProfileContent` in its
 * two hosts - the standalone `/profile` page and the Overlay a ranking page
 * opens (see `CONTEXT.md`) - editing one stored profile. What the journeys
 * hold the workflow to: an edit survives a reload and reaches the pages that
 * rank with it, every control answers to an accessible name, and a profile
 * already in this browser is never rewritten by visiting a page that only
 * reads it.
 *
 * No stubs at all: every request here goes through the dev server's real
 * endpoints. Both projects run - the page and the Overlay are a layout
 * question on a phone - and every wait comes from `support.ts`.
 */

const ROUTE = '/routes/hilly-route'
const PROFILE_KEY = 'zwift-bikes:rider-profile'
const GARAGE_KEY = 'zwift-bikes:garage'

const overlay = (page: Page) => page.getByRole('dialog', { name: 'My Profile' })
const editProfile = (page: Page) => page.getByRole('link', { name: 'Edit profile' })
const strip = (page: Page) => page.getByRole('group', { name: 'Rider' })
const weightSlider = (page: Page) => page.getByRole('slider', { name: 'Rider weight in kilograms' })
const weightLabel = (page: Page) => page.getByText(/^Rider weight: \d+ kg$/)
const draftSelect = (page: Page) => page.getByRole('button', { name: 'Default draft mode', exact: true })

/** Every control the profile offers a rider who is not in a TTT, by the name it answers to. */
const CONTROL_NAMES = [
  'Rider weight in kilograms',
  'Rider height in centimetres',
  'Race power in watts',
  'Sprint power in watts',
  'Assumed upgrade stage for bikes you don\'t own',
  'Default bike category',
  'Show upcoming races',
  'Default draft mode'
]

test.describe('rider profile', () => {
  test('keeps an edit made on the page across a reload and on the pages that rank with it', async ({ page }) => {
    await visitPage(page, '/profile')
    await weightSlider(page).scrollIntoViewIfNeeded()
    const before = Number(await weightSlider(page).getAttribute('aria-valuenow'))
    await dragThumb(page, weightSlider(page), 60)
    const committed = Number(await weightSlider(page).getAttribute('aria-valuenow'))
    expect(committed).toBeGreaterThan(before)
    await expect(weightLabel(page)).toHaveText(`Rider weight: ${committed} kg`)
    expect((await storedProfile(page)).weightKg).toBe(committed)

    await visitPage(page, '/profile')
    await expect(weightSlider(page)).toHaveAttribute('aria-valuenow', String(committed))

    // A saved profile is what the ranking pages rank with, and the warning
    // that they are ranking a phantom rider is gone with it.
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await expect(strip(page)).toContainText(`${committed} kg`)
    await expect(strip(page)).not.toContainText('Using default rider')
  })

  test('reranks the page underneath from the Overlay, then hands focus back to the link that opened it', async ({ page }) => {
    await seedProfile(page, { weightKg: 80, heightCm: 180, powerW: 250, sprintPowerW: 700, draftMode: 'solo' })
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await expect(strip(page)).toContainText('Solo')

    await editProfile(page).click()
    await expect(overlay(page)).toBeVisible()
    await overlay(page).getByRole('button', { name: 'Default draft mode', exact: true }).click()
    const { query } = await rerank(page, () => page.getByRole('option', { name: 'TTT paceline' }).click())
    expect(query.get('draftMode')).toBe('ttt')
    expect((await storedProfile(page)).draftMode).toBe('ttt')

    await page.keyboard.press('Escape')
    await expect(overlay(page)).toHaveCount(0)
    await expect(editProfile(page)).toBeFocused()
    await expect(strip(page)).toContainText('TTT paceline')
  })

  test('names every control, on the page and in the Overlay alike', async ({ page }) => {
    await visitPage(page, '/profile')
    for (const name of CONTROL_NAMES) await expect(page.getByLabel(name)).toBeVisible()

    // The Overlay opens over a ranking page whose own effort sliders carry
    // some of the same names, so each lookup is scoped to the dialog.
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await page.getByRole('link', { name: 'Set your profile' }).click()
    await expect(overlay(page)).toBeVisible()
    for (const name of CONTROL_NAMES) await expect(overlay(page).getByLabel(name)).toBeVisible()

    // The TTT controls appear with the mode they belong to, named the same way.
    await draftSelect(page).click()
    await page.getByRole('option', { name: 'TTT paceline' }).click()
    for (const name of ['Riders in the paceline', 'Team climb pace in watts per kilogram']) {
      await expect(overlay(page).getByLabel(name)).toBeVisible()
    }
  })

  test('clamps a nonsense stored profile and rewrites nothing it was not asked to', async ({ page }) => {
    // Storage is user-editable and survives schema changes, so the page has
    // to cope with a weight past the slider's top and a power that is not a
    // number at all - clamped to the slider's range, and the unusable value
    // left to the composable default rather than carried into a request.
    await seedProfile(page, { weightKg: 999, heightCm: 180, powerW: 'abc' })
    await visitPage(page, '/profile')
    await expect(weightSlider(page)).toHaveAttribute('aria-valuenow', '130')
    await expect(page.getByRole('slider', { name: 'Race power in watts' })).toHaveAttribute('aria-valuenow', '225')

    await weightSlider(page).scrollIntoViewIfNeeded()
    await dragThumb(page, weightSlider(page), -60)
    const written = await storedProfile(page)
    expect(typeof written.weightKg).toBe('number')
    expect(written.weightKg as number).toBeGreaterThanOrEqual(40)
    expect(written.weightKg as number).toBeLessThan(130)
    expect(written.powerW).toBe(225)

    // Reading the profile and the garage leaves both exactly as they were:
    // this slice renamed the words around the upgrade stage, never the
    // stored field, so nothing already in a rider's browser is rewritten.
    const profile = JSON.stringify({ weightKg: 82, heightCm: 178, powerW: 260, sprintPowerW: 800, defaultUnownedLevel: 3, draftMode: 'race', tttRiders: 6 })
    const garage = JSON.stringify({ 1: 4, 17: 0 })
    await page.addInitScript((seed) => {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value)
    }, { [PROFILE_KEY]: profile, [GARAGE_KEY]: garage })
    await visitPage(page, '/profile')
    await expect(weightSlider(page)).toHaveAttribute('aria-valuenow', '82')
    await visitPage(page, '/garage')
    await expect(page.getByRole('switch', { name: 'Only show bikes I own' })).toBeVisible()
    expect(await stored(page, PROFILE_KEY)).toBe(profile)
    expect(await stored(page, GARAGE_KEY)).toBe(garage)
  })

  test('fits a phone, page and Overlay alike', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'a width question, and the desktop viewport is nowhere near the limit')
    await visitPage(page, '/profile')
    await expectNoHorizontalOverflow(page)
    // The TTT controls are the widest row the page has.
    await draftSelect(page).click()
    await page.getByRole('option', { name: 'TTT paceline' }).click()
    await expect(page.getByLabel('Team climb pace in watts per kilogram')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await editProfile(page).click()
    await expect(overlay(page)).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expect(await overlayOverflow(page)).toBeLessThanOrEqual(0)
  })
})

/** Seeds `zwift-bikes:rider-profile` with a payload a test wants read as-is, valid or not - `seedRiderProfile` types its values. */
async function seedProfile(page: Page, profile: Record<string, unknown>) {
  await page.addInitScript((seed) => {
    localStorage.setItem(seed.key, seed.value)
  }, { key: PROFILE_KEY, value: JSON.stringify(profile) })
}

async function stored(page: Page, key: string) {
  return page.evaluate(key => localStorage.getItem(key), key)
}

async function storedProfile(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), PROFILE_KEY)
}

/** How far the Overlay's own content scrolls past its box - a dialog can overflow while the page behind it does not. */
async function overlayOverflow(page: Page) {
  await hydrated(page)
  return overlay(page).evaluate(element => element.scrollWidth - element.clientWidth)
}
