import { expect, test, type Page } from '@playwright/test'
import { isDrillDownUrl, isListingResponse, isListingUrl, ready, visit } from './support'

/**
 * A row's wheel alternatives against the ranking that opened them (issue
 * #235). The list is a comparison - these wheels on this frame, on this
 * ride, for this rider - so it has to be computed under the same request as
 * the row above it, not under controls the rider has moved since. The
 * journey holds a refresh open to put the two apart, and fails it to leave
 * them apart.
 *
 * Assertions are on the drill-down requests rather than the times they
 * return: what the list describes is exactly the query it was asked with,
 * and a time is only wrong here because the query was.
 */

const ROUTE = '/routes/hilly-route'
/** Ranked rows only: the Recommendation carries the same disclosure, and this journey is about a row's. */
const rowsWithWheels = (page: Page) => page.locator('ol[aria-label="Ranked setups"] > li')
  .filter({ has: page.getByRole('button', { name: /^Wheel alternatives/ }) })
const disclosure = (row: ReturnType<typeof rowsWithWheels>) => row.getByRole('button', { name: /^Wheel alternatives/ })

test('asks for wheel alternatives under the ranking on screen, not the controls that moved past it', async ({ page }) => {
  await visit(page, ROUTE)
  const firstRow = rowsWithWheels(page).first()
  const opened = page.waitForRequest(request => isDrillDownUrl(request.url()))
  await disclosure(firstRow).click()
  // The ranking was fetched without the garage restriction, and so is this.
  expect(new URL((await opened).url()).searchParams.get('ownedOnly')).toBeNull()
  await expect(firstRow.getByText('Gaps are against the fastest wheels for this frame')).toBeVisible()
  const openedList = await firstRow.innerText()

  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(url => isListingUrl(url.toString()), async (route) => {
    await held
    await route.fulfill({ status: 500, json: { statusCode: 500, message: 'Ranking refresh failed' } })
  })
  try {
    const failed = page.waitForResponse(response => isListingResponse(response) && response.status() === 500)
    await page.getByRole('switch', { name: 'My garage only' }).click()
    await expect(page.locator('#ride-results')).toHaveAttribute('aria-busy', 'true')

    // Held: the control has moved and the ranking has not, so a disclosure
    // opened now asks under the ranking the rider can see - otherwise this
    // list would compare wheels under a restriction the times beside it
    // were never computed with.
    const duringRefresh = page.waitForRequest(request => isDrillDownUrl(request.url()))
    await disclosure(rowsWithWheels(page).nth(1)).click()
    expect(new URL((await duringRefresh).url()).searchParams.get('ownedOnly')).toBeNull()

    release()
    expect((await failed).status()).toBe(500)
    await ready(page)
    await expect(page.locator('#ride-refresh-notice')).toBeVisible()
    // Failed: the ranking that is still on screen keeps its alternatives.
    expect(await firstRow.innerText()).toBe(openedList)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }

  // Recovered: the replacement ranking brings its own alternatives, asked
  // for under the request that produced it.
  const afterRetry = page.waitForRequest(request => isDrillDownUrl(request.url())
    && new URL(request.url()).searchParams.get('ownedOnly') === 'true')
  await page.locator('#ride-refresh-notice').getByRole('button', { name: 'Try again' }).click()
  expect((await afterRetry).url()).toContain('ownedOnly=true')
  await ready(page)
  await expect(page.locator('#ride-refresh-notice')).toHaveCount(0)
})
