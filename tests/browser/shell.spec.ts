import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, visit, visitPage } from './support'

/**
 * The shared shell (issue #212): the header and its section entries, the
 * mobile menu, the Overlays the shell opens (see `CONTEXT.md`), the skip
 * link and the theme toggle - what every page gets before it renders a
 * thing of its own. Journeys assert what a keyboard rider or a crawler
 * sees: a real href behind every entry, the current section marked, focus
 * that ends up somewhere sensible after an overlay closes.
 *
 * Both projects run: the mobile menu is a different shell, not the desktop
 * one squeezed. Waits come from `support.ts`.
 */

const ROUTE = '/routes/hilly-route'
const SEGMENT = '/segments/fuego-flats'

const header = (page: Page) => page.getByRole('banner')
const menuToggle = (page: Page) => header(page).getByRole('button', { name: 'Open menu' })
/**
 * The mobile menu has no accessible name of its own, so it is the dialog
 * with the section entries in it - which also keeps it apart from the
 * profile overlay it hands over to.
 */
const menu = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('link', { name: 'Routes', exact: true }) })
const profileOverlay = (page: Page) => page.getByRole('dialog', { name: 'My Profile' })

/**
 * Where the section entries live: the header on desktop, the fullscreen
 * menu on mobile, opened here when it is not already. The desktop entries
 * stay in the DOM on mobile but hidden, and role queries skip hidden
 * elements, so the two never answer for each other.
 */
async function nav(page: Page, isMobile: boolean): Promise<Locator> {
  if (!isMobile) return header(page)
  if (!(await menu(page).isVisible())) await menuToggle(page).click()
  await expect(menu(page)).toBeVisible()
  return menu(page)
}

const entry = (within: Locator, name: string) => within.getByRole('link', { name, exact: true })

async function expectMarked(within: Locator, name: string | null) {
  for (const section of ['Routes', 'Segments', 'Events']) {
    if (section === name) await expect(entry(within, section)).toHaveAttribute('aria-current', 'page')
    else await expect(entry(within, section)).not.toHaveAttribute('aria-current', 'page')
  }
}

/** A colour as the browser resolves it, so a token can be compared with a computed style. */
async function resolvedColor(page: Page, cssColor: string) {
  return page.evaluate((cssColor) => {
    const probe = document.createElement('div')
    probe.style.color = cssColor
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, cssColor)
}

test.describe('shell', () => {
  test('marks the current section and reaches every page by a real href', async ({ page, isMobile }) => {
    await visit(page, ROUTE)
    await expectNoHorizontalOverflow(page)
    let entries = await nav(page, isMobile)
    await expectNoHorizontalOverflow(page)
    await expect(entry(entries, 'Routes')).toHaveAttribute('href', '/')
    await expect(entry(entries, 'Segments')).toHaveAttribute('href', '/segments')
    await expect(entry(entries, 'Events')).toHaveAttribute('href', '/events')
    await expect(entry(entries, 'My Profile')).toHaveAttribute('href', '/profile')
    await expect(entry(entries, 'My Garage')).toHaveAttribute('href', '/garage')
    await expectMarked(entries, 'Routes')

    // The mark is the primary colour, nothing else: no pill, no underline.
    const primary = await resolvedColor(page, 'var(--ui-primary)')
    expect(await entry(entries, 'Routes').evaluate(element => getComputedStyle(element).color)).toBe(primary)
    expect(await entry(entries, 'Segments').evaluate(element => getComputedStyle(element).color)).not.toBe(primary)

    await entry(entries, 'Segments').click()
    await page.waitForURL('**/segments')
    entries = await nav(page, isMobile)
    await expectMarked(entries, 'Segments')

    await visit(page, SEGMENT)
    await expectMarked(await nav(page, isMobile), 'Segments')
    await expectNoHorizontalOverflow(page)

    await visitPage(page, '/events')
    await expectMarked(await nav(page, isMobile), 'Events')
    await expectNoHorizontalOverflow(page)

    await visitPage(page, '/profile')
    await expectMarked(await nav(page, isMobile), null)
    await expectNoHorizontalOverflow(page)
  })

  test('puts the skip link first in the tab order and lands it in the main region', async ({ page }) => {
    await visit(page, ROUTE)
    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: 'Skip to content' })
    await expect(skipLink).toBeFocused()
    await expect(skipLink).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(page.locator('main')).toBeFocused()
  })

  test('opens the profile overlay on a plain click and the profile page on a modifier click', async ({ page, context, isMobile }) => {
    await visit(page, ROUTE)
    let entries = await nav(page, isMobile)
    await entry(entries, 'My Profile').click()
    await expect(profileOverlay(page)).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(ROUTE)
    await page.keyboard.press('Escape')
    await expect(profileOverlay(page)).toHaveCount(0)

    entries = await nav(page, isMobile)
    const popupPromise = context.waitForEvent('page')
    await entry(entries, 'My Profile').click({ modifiers: ['ControlOrMeta'] })
    const popup = await popupPromise
    await popup.waitForURL('**/profile')
    expect(new URL(page.url()).pathname).toBe(ROUTE)
    await expect(profileOverlay(page)).toHaveCount(0)
    await popup.close()
  })

  test('hands the keyboard from the menu to an overlay and back to the toggle', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the menu only exists on mobile')
    await visit(page, ROUTE)
    await menuToggle(page).focus()
    await page.keyboard.press('Enter')
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(menuToggle(page)).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(menu(page)).toBeVisible()
    await entry(menu(page), 'My Profile').focus()
    await page.keyboard.press('Enter')
    await expect(profileOverlay(page)).toBeVisible()
    await expect(menu(page)).toHaveCount(0)
    expect(new URL(page.url()).pathname).toBe(ROUTE)
    await page.keyboard.press('Escape')
    await expect(profileOverlay(page)).toHaveCount(0)
    await expect(menuToggle(page)).toBeFocused()
  })

  test('carries the theme into an overlay', async ({ page, isMobile }) => {
    await visit(page, ROUTE)
    const bodyBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const lightGround = await bodyBackground()
    await header(page).getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    // The dark ground is the palette's deepest neutral (main.css re-points
    // `--ui-bg` to it), not merely "whatever `--ui-bg` is": that would hold
    // in light mode too.
    const ground = await resolvedColor(page, 'var(--ui-color-neutral-950)')
    expect(ground).not.toBe(lightGround)
    expect(await bodyBackground()).toBe(ground)

    await entry(await nav(page, isMobile), 'My Profile').click()
    await expect(profileOverlay(page)).toBeVisible()
    expect(await profileOverlay(page).evaluate(element => getComputedStyle(element).backgroundColor)).toBe(ground)
  })
})
