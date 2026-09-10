import { expect, test, type Page } from '@playwright/test'
import { visit, visitPage } from './support'

/**
 * The runtime site flags as a rider meets them (issue #212, `docs/site-flags.md`):
 * a hidden section leaves the nav and answers a direct visit with a notice,
 * and a message of the day shows until dismissed, then stays dismissed.
 *
 * This is the one file that stubs `/api/site-flags` - the README's stub rule
 * names it. The flags live in Workers KV and the dev server answers with the
 * defaults (nothing hidden, no message), so the only way to see a live flag
 * in a journey is to answer the request by hand. The stub is the condition
 * under test, not a shortcut.
 */

const ROUTE = '/routes/hilly-route'
const MESSAGE = 'Rankings are being re-verified after the game update.'
const NOTICE = 'Back next season.'
const DISMISSED_KEY = 'zwift-bikes:dismissed-motd'

const FLAGS = {
  motd: { id: 'shell-212', message: MESSAGE, tone: 'info', dismissible: true },
  sections: { events: { mode: 'hidden', notice: NOTICE } },
  notices: {}
}

const banner = (page: Page) => page.getByText(MESSAGE)
/** Every Events entry, desktop nav and mobile menu alike: a hidden section renders none, visible or not. */
const eventsEntries = (page: Page) => page.locator('a[href="/events"]')
const menuToggle = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Open menu' })

test.describe('site flags', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/site-flags', route => route.fulfill({ json: FLAGS }))
  })

  test('takes a hidden section out of the nav and answers a direct visit with the notice', async ({ page, isMobile }) => {
    await visit(page, ROUTE)
    // The flags arrive after mount; the banner is the first thing they change.
    await expect(banner(page)).toBeVisible()
    await expect(eventsEntries(page)).toHaveCount(0)
    if (isMobile) {
      await menuToggle(page).click()
      const menu = page.getByRole('dialog')
      await expect(menu.getByRole('link', { name: 'Segments', exact: true })).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Events', exact: true })).toHaveCount(0)
    }

    await visitPage(page, '/events')
    await expect(page.getByText('The events calendar is taking a break')).toBeVisible()
    await expect(page.getByText(NOTICE)).toBeVisible()
  })

  test('shows the message of the day until dismissed, and keeps the dismissal across a reload', async ({ page }) => {
    await visit(page, ROUTE)
    // The flags arrive after mount; the banner is the first thing they change.
    await expect(banner(page)).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(banner(page)).toHaveCount(0)
    expect(await page.evaluate(key => localStorage.getItem(key), DISMISSED_KEY)).toBe(FLAGS.motd.id)

    await visit(page, ROUTE)
    // The flags reached the page (the section is gone again) and the message did not come back.
    await expect(eventsEntries(page)).toHaveCount(0)
    await expect(banner(page)).toHaveCount(0)
  })
})
