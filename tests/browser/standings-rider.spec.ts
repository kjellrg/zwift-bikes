import { expect, test, type Page } from '@playwright/test'
import { visitPage } from './support'

/**
 * The Rider switch on a Standings page shows the committed standings of the
 * default rider or of the race rider. The default rider's table is in the
 * page payload; the race rider's is fetched when asked for, and the choice
 * is kept in the URL as `?rider=race`.
 */

const raceRequests = (page: Page) => {
  const urls: string[] = []
  page.on('request', request => request.url().includes('/api/standings/') && request.url().includes('rider=race') && urls.push(request.url()))
  return urls
}

const caption = (page: Page) => page.getByText(/Times are for /)

for (const path of ['/bikes', '/wheels']) {
  test(`${path}: the Race rider chip swaps the standings, asks for its table once, and says who is timed`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop journey covers the switch')
    const requests = raceRequests(page)
    await visitPage(page, path)

    await expect(caption(page)).toContainText('the default rider, 75 kg at 225 W, solo')
    expect(requests).toHaveLength(0)
    const rows = page.getByRole('main').getByRole('table').getByRole('row')
    const before = await rows.nth(1).innerText()

    await page.getByRole('button', { name: /^Race rider/ }).click()
    await expect(caption(page)).toContainText('the race rider, 80 kg at 280 W, race draft')
    await expect(page).toHaveURL(/rider=race/)
    await expect.poll(async () => await rows.nth(1).innerText()).not.toBe(before)
    expect(requests).toHaveLength(1)

    // Back and forth makes no second request.
    await page.getByRole('button', { name: /^Default rider/ }).click()
    await expect(caption(page)).toContainText('the default rider')
    await expect(page).not.toHaveURL(/rider=/)
    await expect.poll(async () => await rows.nth(1).innerText()).toBe(before)
    await page.getByRole('button', { name: /^Race rider/ }).click()
    await expect(caption(page)).toContainText('the race rider')
    expect(requests).toHaveLength(1)
  })
}

test('a link with ?rider=race opens on the race rider, next to the filters in its URL', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop journey covers the link')
  await visitPage(page, '/bikes?rider=race&category=tt')
  await expect(page.getByRole('button', { name: /^Race rider/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Time trial' })).toHaveAttribute('aria-pressed', 'true')
  await expect(caption(page)).toContainText('the race rider, 80 kg at 280 W')
  await expect(page).toHaveURL(/rider=race/)
  await expect(page).toHaveURL(/category=tt/)
  await expect(page.getByRole('main').getByRole('table').getByRole('row')).not.toHaveCount(1)
})

test('a failed race fetch says so, and choosing the race rider again tries again', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop journey covers the retry')
  let fail = true
  await page.route('**/api/standings/bikes?rider=race', (route) => {
    if (fail) return route.fulfill({ status: 500, body: 'nope' })
    return route.continue()
  })
  await visitPage(page, '/bikes')

  await page.getByRole('button', { name: /^Race rider/ }).click()
  await expect(page.getByText('Couldn\'t load routes.')).toBeVisible()

  fail = false
  await page.getByRole('button', { name: /^Default rider/ }).click()
  await page.getByRole('button', { name: /^Race rider/ }).click()
  await expect(page.getByText('Couldn\'t load routes.')).toBeHidden()
  await expect(caption(page)).toContainText('the race rider')
})
