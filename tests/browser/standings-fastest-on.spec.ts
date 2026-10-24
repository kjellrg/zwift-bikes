import { expect, test, type Page } from '@playwright/test'
import { visitPage } from './support'

/**
 * The Fastest on count of a Standings row opens an Overlay listing those
 * routes, each a link to its page. The count and the list are the same
 * routes, and a link takes the rider off the Overlay to the route.
 */

const firstWinner = (page: Page) => page.getByRole('main').getByRole('button', { name: /routes? .+ is fastest on$/ }).first()

for (const path of ['/bikes', '/wheels']) {
  test(`${path}: the Fastest on count lists the routes it counts, and a route opens its page`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the list')
    await visitPage(page, path)

    const opener = firstWinner(page)
    const count = Number((await opener.innerText()).match(/^\d+/)![0])
    await opener.click()

    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    const links = drawer.getByRole('list', { name: 'Routes' }).getByRole('link')
    await expect(links).toHaveCount(count)

    const href = await links.first().getAttribute('href')
    expect(href).toMatch(/^\/routes\/[^/?]+$/)
    await links.first().click()
    await expect(page).toHaveURL(new RegExp(`${href}(\\?|$)`))
    await expect(drawer).toBeHidden()
  })
}

test('a Time trial list links each route in its Time trial category', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop journey covers the link')
  await visitPage(page, '/bikes?category=tt')
  await firstWinner(page).click()
  const link = page.getByRole('dialog').getByRole('list', { name: 'Routes' }).getByRole('link').first()
  await expect(link).toHaveAttribute('href', /^\/routes\/[^/?]+\?category=tt$/)
})

test.describe('a bike on the Bikes page', () => {
  test('opens its drawer: its place, its terrain, its upgrade stages and its closest routes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the drawer')
    await visitPage(page, '/bikes')

    const table = page.getByRole('main').getByRole('table')
    const opener = table.getByRole('button', { name: /^Details for / }).first()
    const name = (await opener.innerText()).trim()
    await opener.click()

    const drawer = page.getByRole('dialog')
    await expect(drawer.getByRole('heading', { name })).toBeVisible()
    await expect(drawer.getByText(/^Rank 1 of \d+ over \d+ routes$/)).toBeVisible()
    await expect(drawer.getByRole('table', { name: 'Mean gap to the fastest by route terrain' })).toBeVisible()
    // The frame arrives from its own request, after the drawer is open.
    const stages = drawer.getByRole('table', { name: 'What each upgrade stage adds, in seconds per hour' })
    await expect(stages).toBeVisible()
    await expect(stages.getByRole('row')).toHaveCount(6)

    const closest = drawer.getByRole('list', { name: 'Closest to the runner-up' }).getByRole('link').first()
    await closest.click()
    await expect(page).toHaveURL(/\/routes\//)
    await expect(drawer).toBeHidden()
  })

  test('a bike that is not the fastest is measured against the fastest, the fastest against the runner-up', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the drawer')
    await visitPage(page, '/bikes')
    const openers = page.getByRole('main').getByRole('table').getByRole('button', { name: /^Details for / })
    const drawer = page.getByRole('dialog')

    await openers.first().click()
    await expect(drawer.getByText('This is the fastest bike, so the lists below are its margins to the runner-up').first()).toBeVisible()
    // Where it loses nothing on a terrain it says so, rather than printing a gap of nothing.
    await expect(drawer.getByRole('table', { name: 'Mean gap to the fastest by route terrain' }).getByRole('cell', { name: 'Fastest', exact: true }).first()).toBeVisible()
    await expect(drawer.getByText('0.00%', { exact: true })).toHaveCount(0)
    await expect(drawer.getByRole('list', { name: 'Closest to the fastest' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()

    await openers.nth(1).click()
    await expect(drawer.getByRole('list', { name: 'Closest to the fastest' })).toBeVisible()
    await expect(drawer.getByRole('list', { name: 'Closest to the runner-up' })).toHaveCount(0)
  })

  test('a wheelset on the Wheels page has no bike drawer', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the page')
    await visitPage(page, '/wheels')
    await expect(page.getByRole('main').getByRole('table').getByRole('button', { name: /^Details for / })).toHaveCount(0)
  })
})
