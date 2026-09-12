import { expect, test } from '@playwright/test'
import { isListingResponse, isListingUrl, ready, rerank, visit } from './support'

for (const [kind, path] of [
  ['route', '/routes/hilly-route'],
  ['segment', '/segments/fuego-flats'],
  ['race', '/events/zracing-2026/stage-1']
]) {
  for (const outcome of ['success', 'failure']) {
    test(`${kind}: keeps the expanded Applied Ranking coherent through Garage refresh ${outcome}`, async ({ page }) => {
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
          await expect(page.getByText('Results updated', { exact: true })).toHaveCount(0)
        } else {
          await expect(rows).toHaveCount(oldRows.length)
          await expect(answer).not.toHaveText(oldAnswer, { useInnerText: true })
          await expect(scope).toContainText('All frames / your wheels')
          await expect(more).toBeEnabled()
        }
      } finally {
        release()
        await page.unrouteAll({ behavior: 'wait' })
      }
    })
  }
}
