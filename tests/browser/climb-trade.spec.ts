import { expect, test, type Page } from '@playwright/test'
import { isListingResponse, seedRiderProfile, visit } from './support'

/**
 * The Climb trade and the Wheel close call (issues #258, #261): the two
 * lines that tell a racer what the Ranking assumes away - that they stay with
 * the group on the climbs. Innsbruck KOM After Party is the ride the issue
 * measured: a rider who owns the Tron and the Aethos is told to ride the
 * Tron, and the Aethos gets over the KOM about 21 s sooner for about 8 s over
 * the race.
 */

const ROUTE = '/routes/innsbruck-kom-after-party'
// Zwift Concept Z1 (the Tron) and Specialized Aethos S-Works.
const GARAGE = { 1456463855: 5, 2346116422: 5 }

const climbTrade = (page: Page) => page.locator('p').filter({ hasText: /^\s*Dropped on the climbs\?/ })
const why = (page: Page) => page.locator('section:has(#ride-why-heading)')

interface ClimbTradeBody {
  climbTrade?: { frameName: string, climbName: string, gainSec: number, costSec: number }
}

/** Seeds the garage and the "my bikes only" switch before the page reads them. */
async function seedGarage(page: Page) {
  await page.addInitScript((frames) => {
    localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ myBikesOnly: true }))
    localStorage.setItem('zwift-bikes:garage', JSON.stringify(frames))
  }, GARAGE)
}

test.describe('climb trade', () => {
  test('names the lighter bike in the garage under race drafting, with the numbers the ranking was timed with', async ({ page }) => {
    await seedGarage(page)
    await seedRiderProfile(page, { weightKg: 75, heightCm: 175, powerW: 240, draftMode: 'race' })
    const listing = page.waitForResponse(response => isListingResponse(response) && response.url().includes('draftMode=race'))
    await visit(page, ROUTE)
    const body = await (await listing).json() as ClimbTradeBody

    expect(body.climbTrade).toMatchObject({ frameName: 'Specialized Aethos S-Works', climbName: 'Innsbruck KOM' })
    await expect(climbTrade(page)).toBeVisible()
    await expect(climbTrade(page)).toContainText(`On the Innsbruck KOM the Specialized Aethos S-Works`)
    await expect(climbTrade(page)).toContainText(`is ${Math.round(body.climbTrade!.gainSec)} s quicker at your power, and ${body.climbTrade!.costSec.toFixed(1)} s slower over the race.`)
    await expect(climbTrade(page)).toContainText('If the Innsbruck KOM is where you lose the front group, ride the Specialized Aethos S-Works.')
    // Beside the answer, not in place of it: rank 1 stays the Tron.
    await expect(page.locator('section:has(#ride-recommendation-heading)')).toContainText('Zwift Concept Z1')
  })

  test('says nothing solo, where there is no bunch to lose', async ({ page }) => {
    // Solo on Innsbruck the Aethos simply wins, so the question never comes
    // up there. On Keith Hill the Tron still wins solo, and the Aethos is
    // quicker on the climb by a margin a race would name.
    await seedGarage(page)
    await seedRiderProfile(page, { weightKg: 75, heightCm: 175, powerW: 240, draftMode: 'solo' })
    await visit(page, '/routes/keith-hill-after-party')
    await expect(page.locator('section:has(#ride-recommendation-heading)')).toContainText('Zwift Concept Z1')
    await expect(climbTrade(page)).toHaveCount(0)
  })
})

test.describe('wheel close call', () => {
  test('says disc or regular is a close call on rank 1\'s frame', async ({ page }) => {
    await seedRiderProfile(page, { weightKg: 75, heightCm: 175, powerW: 240, draftMode: 'race' })
    await visit(page, ROUTE)
    await expect(why(page)).toContainText(/Disc or regular wheels is a close call: the .+ is [\d.]+ s faster than the .+(heavier|lighter)\./)
  })
})
