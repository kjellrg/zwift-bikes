import { expect, test, type Locator, type Page } from '@playwright/test'
import { hydrated, navigateUnderOverlay, visit, visitPage } from './support'

/**
 * Dismissing an Overlay (issue #239): the back gesture, and the swipe that
 * reverses the Overlay's entrance. On a phone in portrait an Overlay fills
 * the viewport and reads as a page, so back is the gesture a rider reaches
 * for first - and the rule is site-wide, which is why every journey here runs
 * on both projects unless the gesture itself is touch-only.
 *
 * `page.goBack()` is the rider's gesture as far as the browser is concerned:
 * Android's hardware button, iOS's edge-swipe and the desktop back button all
 * arrive as the same `popstate`. What it cannot exercise is the touch drag,
 * hence the synthetic touches below - and, in the ticket, a by-hand check on a
 * real phone that no agent can discharge.
 *
 * Journeys assert what the rider is left with - what closed, what is still on
 * screen, where the next back press lands - never the pushed entry itself.
 */

const ROUTE = '/routes/hilly-route'

const header = (page: Page) => page.getByRole('banner')
const menuToggle = (page: Page) => header(page).getByRole('button', { name: 'Open menu' })
/** The mobile menu has no accessible name of its own, so it is the dialog with the section entries in it. */
const menu = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('link', { name: 'Routes', exact: true }) })
const profileOverlay = (page: Page) => page.getByRole('dialog', { name: 'My Profile' })
const aboutOverlay = (page: Page) => page.getByRole('dialog', { name: 'About ZwiftBikes' })
const reportOverlay = (page: Page) => page.getByRole('dialog', { name: 'Report an issue' })
const drawer = (page: Page) => page.getByRole('dialog')
const ranking = (page: Page) => page.locator('#ride-results')

/** An entry wherever this viewport keeps it: the header, or the menu opened for it. */
async function navEntry(page: Page, isMobile: boolean, name: string): Promise<Locator> {
  if (!isMobile) return header(page).getByRole('link', { name, exact: true })
  if (!(await menu(page).isVisible())) await menuToggle(page).click()
  await expect(menu(page)).toBeVisible()
  return menu(page).getByRole('link', { name, exact: true })
}

const path = (page: Page) => new URL(page.url()).pathname

/**
 * A touch drag across the open Overlay's own panel, in `steps` moves. Real
 * `Touch` objects dispatched at the dialog element, which is where the
 * handler listens (`useSwipeDismiss`) - Playwright's touchscreen can tap and
 * nothing else.
 */
async function drag(panel: Locator, dx: number, dy: number, steps = 6) {
  await panel.evaluate((element, { dx, dy, steps }) => {
    const box = element.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + Math.min(60, box.height / 2)
    const at = (offsetX: number, offsetY: number) => new Touch({ identifier: 1, target: element, clientX: x + offsetX, clientY: y + offsetY })
    const fire = (type: string, touch: Touch) => element.dispatchEvent(new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: type === 'touchend' ? [] : [touch],
      targetTouches: type === 'touchend' ? [] : [touch],
      changedTouches: [touch]
    }))
    fire('touchstart', at(0, 0))
    for (let step = 1; step <= steps; step++) fire('touchmove', at((dx * step) / steps, (dy * step) / steps))
    fire('touchend', at(dx, dy))
  }, { dx, dy, steps })
}

test.describe('overlay dismissal', () => {
  test('back closes the Overlay and leaves the rider on the page', async ({ page, isMobile }) => {
    await visit(page, ROUTE)
    await (await navEntry(page, isMobile, 'My Profile')).click()
    await expect(profileOverlay(page)).toBeVisible()
    // The address bar never moves: the entry an Overlay pushes is for the
    // same URL, and no Shared view value is written.
    expect(path(page)).toBe(ROUTE)

    await page.goBack()
    await expect(profileOverlay(page)).toHaveCount(0)
    expect(path(page)).toBe(ROUTE)
    await expect(ranking(page)).toBeVisible()
  })

  test('leaves no dead entry behind when the Overlay is closed by hand', async ({ page, isMobile }) => {
    await visitPage(page, '/segments')
    await visit(page, ROUTE)
    await (await navEntry(page, isMobile, 'My Profile')).click()
    await expect(profileOverlay(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(profileOverlay(page)).toHaveCount(0)

    // The close took its own entry with it, so this back press is the one the
    // rider means: off the page, not a gesture that visibly does nothing.
    await page.goBack()
    await expect(page).toHaveURL(/\/segments$/)
  })

  test('spends one entry on a whole chain', async ({ page, isMobile }) => {
    await visit(page, ROUTE)

    if (isMobile) {
      // The menu is not an Overlay, but it follows the same rule: it hands
      // over to the Overlay it opened, and the pair costs one back press.
      await menuToggle(page).click()
      await expect(menu(page)).toBeVisible()
      await menu(page).getByRole('link', { name: 'About', exact: true }).click()
      await expect(aboutOverlay(page)).toBeVisible()
      await expect(menu(page)).toHaveCount(0)
    } else {
      await (await navEntry(page, isMobile, 'About')).click()
      await expect(aboutOverlay(page)).toBeVisible()
    }

    // About swapping itself for the report form is a swap, not a descent.
    await aboutOverlay(page).getByRole('link', { name: 'Report an issue' }).click()
    await expect(reportOverlay(page)).toBeVisible()
    await expect(aboutOverlay(page)).toHaveCount(0)

    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(path(page)).toBe(ROUTE)
    await expect(ranking(page)).toBeVisible()
    // The menu the chain started from has long since unmounted, so the
    // toggle is where focus has to land - a back-initiated close is no
    // different from an Esc one in that (`app.vue`'s `overlayContent`).
    if (isMobile) await expect(menuToggle(page)).toBeFocused()
  })

  test('leaves the rider on the page the mobile menu sent them to', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the menu only exists on mobile')
    await visit(page, ROUTE)
    await menuToggle(page).click()
    await expect(menu(page)).toBeVisible()

    // The menu closes itself on the navigation its own entry made, which is
    // the one close that must not take a history entry with it: the entry it
    // pushed is no longer the one the rider is standing on.
    await menu(page).getByRole('link', { name: 'Segments', exact: true }).click()
    await expect(page).toHaveURL(/\/segments$/)
    await hydrated(page)
    await expect(menu(page)).toHaveCount(0)
    await expect(page, 'the menu closing must not send the rider back').toHaveURL(/\/segments$/)

    // And back is the page the menu was opened over, in one press.
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${ROUTE}$`))
  })

  test('retraces an Overlay and a navigation in order, one back press each', async ({ page }) => {
    await visit(page, ROUTE)
    await page.getByRole('button', { name: /^Details for / }).first().click()
    await expect(drawer(page)).toBeVisible()

    // The drawer outlives a client-side navigation by design, and the
    // barred-frame attribution depends on it (`race-recommendation.spec.ts`).
    await navigateUnderOverlay(page, '/segments')
    await expect(drawer(page)).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${ROUTE}$`))
    await expect(drawer(page), 'the first back press undoes the navigation, not the drawer').toBeVisible()

    await page.goBack()
    await expect(drawer(page)).toHaveCount(0)
    expect(path(page)).toBe(ROUTE)
  })

  test('closes a centred Overlay on a swipe down and the drawer on a swipe right', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the swipe is a touch gesture')
    await visitPage(page, '/segments')
    await visit(page, ROUTE)

    await (await navEntry(page, isMobile, 'My Profile')).click()
    await expect(profileOverlay(page)).toBeVisible()
    // Up is not the way out: the gesture that reverses the entrance is the
    // only one that dismisses.
    await drag(profileOverlay(page), 0, -160)
    await expect(profileOverlay(page)).toBeVisible()
    await drag(profileOverlay(page), 0, 240)
    await expect(profileOverlay(page)).toHaveCount(0)

    // And the swipe leaves no entry behind either, exactly like Esc.
    await page.goBack()
    await expect(page).toHaveURL(/\/segments$/)

    await visit(page, ROUTE)
    await page.getByRole('button', { name: /^Details for / }).first().click()
    await expect(drawer(page)).toBeVisible()
    await drag(drawer(page), -160, 0)
    await expect(drawer(page)).toBeVisible()
    await drag(drawer(page), 240, 0)
    await expect(drawer(page)).toHaveCount(0)
  })
})
