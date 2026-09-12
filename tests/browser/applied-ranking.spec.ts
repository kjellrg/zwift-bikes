import { expect, test, type Page } from '@playwright/test'
import { isListingResponse, isListingUrl, ready, rerank, visit } from './support'

/** The persistent notice beside the ranking (issue #234), which outlives the toast that speaks at the moment of failure. */
const refreshNotice = (page: Page) => page.locator('#ride-refresh-notice')
/** The live region's text, which must appear only when a ranking is accepted. */
const announcement = (page: Page) => page.getByText('Results updated', { exact: true })

for (const [kind, path] of [
  ['route', '/routes/hilly-route'],
  ['segment', '/segments/fuego-flats'],
  ['race', '/events/zracing-2026/stage-1']
]) {
  for (const outcome of ['success', 'failure']) {
    test(`${kind}: keeps the expanded Applied Ranking coherent through Garage refresh ${outcome}, and recovers`, async ({ page }) => {
      await visit(page, path!)
      await rerank(page, () => page.getByRole('switch', { name: 'My garage only' }).click())
      const rows = page.locator('ol[aria-label="Ranked setups"] > li')
      const more = page.getByRole('button', { name: 'Show more matches' })
      const initialRows = await rows.count()
      const expansion = page.waitForResponse(response => isListingResponse(response)
        && Number(new URL(response.url()).searchParams.get('offset')) > 0)
      await more.click()
      expect((await expansion).ok()).toBe(true)
      await expect.poll(() => rows.count()).toBeGreaterThan(initialRows)

      const answer = page.locator('section:has(#ride-answer-heading)')
      const oldAnswer = await answer.innerText()
      const oldRows = await rows.allInnerTexts()
      const scope = page.getByText(/Other filters and compatibility still apply\./)
      const oldScope = await scope.innerText()
      const recommendation = page.locator('section:has(#ride-recommendation-heading)')
      const oldRecommendation = await recommendation.innerText()

      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route(url => isListingUrl(url.toString()) && url.searchParams.has('ownedWheels'), async (route) => {
        if (Number(new URL(route.request().url()).searchParams.get('offset')) === 0) {
          await route.continue()
          return
        }
        await held
        if (outcome === 'failure') {
          await route.fulfill({ status: 400, json: { statusCode: 400, message: 'Required refresh page failed' } })
        } else {
          await route.continue()
        }
      })

      try {
        await page.getByRole('link', { name: 'Edit garage' }).click()
        const garage = page.getByRole('dialog', { name: 'My Garage' })
        await garage.getByRole('tab', { name: 'Wheels', exact: true }).click()
        await garage.getByRole('textbox', { name: 'Search wheels' }).fill('Roval Alpinist CLX')
        const firstPage = page.waitForResponse(response => isListingResponse(response)
          && new URL(response.url()).searchParams.has('ownedWheels')
          && Number(new URL(response.url()).searchParams.get('offset')) === 0)
        await garage.getByRole('switch', { name: 'Mark Roval Alpinist CLX as owned' }).click()
        expect((await firstPage).ok()).toBe(true)
        await page.keyboard.press('Escape')
        await expect(garage).toHaveCount(0)

        await expect(page.locator('#ride-results')).toHaveAttribute('aria-busy', 'true')
        await expect(more).toBeDisabled()
        expect(await rows.allInnerTexts()).toEqual(oldRows)

        // Dimmed, not embargoed: the rows are still the accepted ranking's,
        // so what a rider can do with them stays available while their
        // replacement is fetched (#234).
        await rows.first().getByRole('button', { name: /^Details for / }).click()
        const drawer = page.getByRole('dialog')
        await expect(drawer).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(drawer).toHaveCount(0)
        await expect(answer).toHaveText(oldAnswer, { useInnerText: true })
        await expect(scope).toHaveText(oldScope, { useInnerText: true })
        await expect(recommendation).toHaveText(oldRecommendation, { useInnerText: true })

        release()
        await ready(page)
        if (outcome === 'failure') {
          expect(await rows.allInnerTexts()).toEqual(oldRows)
          await expect(answer).toHaveText(oldAnswer, { useInnerText: true })
          await expect(scope).toHaveText(oldScope, { useInnerText: true })
          await expect(recommendation).toHaveText(oldRecommendation, { useInnerText: true })
          await expect(more).toBeDisabled()
          await expect(announcement(page)).toHaveCount(0)

          // The failure says so where the rider is looking, and stays said:
          // the toast has its own few seconds and this does not (#234).
          await expect(refreshNotice(page)).toBeVisible()
          await expect(refreshNotice(page)).toContainText('does not answer your latest choices')
          // The choices themselves stay live under the notice.
          await expect(page.getByRole('switch', { name: 'My garage only' })).toBeEnabled()

          // Try again asks for the whole refresh the failure interrupted -
          // both pages of the expanded ranking, under the latest choices.
          await page.unrouteAll({ behavior: 'wait' })
          const deeperPage = page.waitForResponse(response => isListingResponse(response)
            && new URL(response.url()).searchParams.has('ownedWheels')
            && Number(new URL(response.url()).searchParams.get('offset')) > 0)
          await refreshNotice(page).getByRole('button', { name: 'Try again' }).click()
          expect((await deeperPage).ok()).toBe(true)
          await ready(page)
          await expect(refreshNotice(page)).toHaveCount(0)
          await expect(rows).toHaveCount(oldRows.length)
          await expect(scope).toContainText('All frames / your wheels')
          await expect(more).toBeEnabled()
          await expect(announcement(page)).toHaveCount(1)
        } else {
          await expect(rows).toHaveCount(oldRows.length)
          await expect(answer).not.toHaveText(oldAnswer, { useInnerText: true })
          await expect(scope).toContainText('All frames / your wheels')
          await expect(more).toBeEnabled()
          await expect(announcement(page)).toHaveCount(1)
        }
      } finally {
        release()
        await page.unrouteAll({ behavior: 'wait' })
      }
    })
  }
}

test('route: keeps the ranking when Show more fails, and adds the page on the next press', async ({ page }) => {
  await visit(page, '/routes/hilly-route')
  const rows = page.locator('ol[aria-label="Ranked setups"] > li')
  const more = page.getByRole('button', { name: 'Show more matches' })
  const failureLine = page.getByText('Couldn\'t load more matches - the ranking above is unchanged.')
  const before = await rows.count()

  await page.route(url => isListingUrl(url.toString()) && Number(url.searchParams.get('offset')) > 0,
    route => route.fulfill({ status: 500, json: { statusCode: 500, message: 'Expansion failed' } }))
  try {
    const failed = page.waitForResponse(response => isListingResponse(response) && response.status() === 500)
    await more.click()
    expect((await failed).status()).toBe(500)
    // Nothing was taken away, so the ranking keeps its own notice out of
    // it: the press is the recovery, and the button is live again.
    await expect(failureLine).toBeVisible()
    await expect(refreshNotice(page)).toHaveCount(0)
    await expect.poll(() => rows.count()).toBe(before)
    await expect(more).toBeEnabled()
  } finally {
    await page.unrouteAll({ behavior: 'wait' })
  }

  const added = page.waitForResponse(response => isListingResponse(response)
    && Number(new URL(response.url()).searchParams.get('offset')) > 0)
  await more.click()
  expect((await added).ok()).toBe(true)
  await expect.poll(() => rows.count()).toBeGreaterThan(before)
  await expect(failureLine).toHaveCount(0)
})
