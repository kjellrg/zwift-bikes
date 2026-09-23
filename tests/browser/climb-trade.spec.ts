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

/** Seeds the garage, with the "my bikes only" switch on or off, before the page reads them. */
async function seedGarage(page: Page, myBikesOnly: boolean) {
  await page.addInitScript(({ frames, myBikesOnly }) => {
    localStorage.setItem('zwift-bikes:preferences', JSON.stringify({ myBikesOnly }))
    localStorage.setItem('zwift-bikes:garage', JSON.stringify(frames))
  }, { frames: GARAGE, myBikesOnly })
}

const answer = (page: Page) => page.locator('section:has(#ride-recommendation-heading)')
/** Rank 1's frame, by the Recommendation's own details button - the section also holds the notes beside it. */
const rank1 = async (page: Page) => (await answer(page).getByRole('button', { name: /^Details for / }).first().innerText()).trim()

/** Opens the ride as the issue's 240 W rider, returning the response the page ranked it from. A solo request carries no `draftMode`. */
async function visitUnder(page: Page, draftMode: 'race' | 'solo') {
  await seedRiderProfile(page, { weightKg: 75, heightCm: 175, powerW: 240, draftMode })
  const listing = page.waitForResponse(response => isListingResponse(response) && response.url().includes('powerW=240')
    && (draftMode === 'race') === response.url().includes('draftMode=race'))
  await visit(page, ROUTE)
  return await (await listing).json() as ClimbTradeBody
}

test.describe('climb trade', () => {
  test('names the lighter bike in the garage under race drafting, with the numbers the ranking was timed with', async ({ page }) => {
    await seedGarage(page, true)
    const body = await visitUnder(page, 'race')

    expect(body.climbTrade).toMatchObject({ frameName: 'Specialized Aethos S-Works', climbName: 'Innsbruck KOM' })
    await expect(climbTrade(page)).toBeVisible()
    await expect(climbTrade(page)).toContainText(`On the Innsbruck KOM the Specialized Aethos S-Works`)
    await expect(climbTrade(page)).toContainText(`is ${Math.round(body.climbTrade!.gainSec)} s quicker at your power, and ${body.climbTrade!.costSec.toFixed(1)} s slower over the race.`)
    await expect(climbTrade(page)).toContainText('If the Innsbruck KOM is where you lose the front group, ride the Specialized Aethos S-Works.')
    // Beside the answer, not in place of it: rank 1 stays the Tron.
    expect(await rank1(page)).toBe('Zwift Concept Z1')
  })

  test('weighs the garage against a rank 1 the rider does not own, and says nothing on the same ride solo', async ({ page, context }) => {
    // "My bikes only" off: the whole field is ranked, and a bike from outside
    // the garage wins. The trade is still between that answer and the
    // garage's own bikes.
    await seedGarage(page, false)
    const race = await visitUnder(page, 'race')
    expect(['Zwift Concept Z1', 'Specialized Aethos S-Works']).not.toContain(await rank1(page))
    expect(race.climbTrade?.frameName).toBe('Specialized Aethos S-Works')
    await expect(climbTrade(page)).toContainText('ride the Specialized Aethos S-Works.')

    // Solo there is no bunch to lose - and on this ride the Aethos would
    // otherwise clear both thresholds solo too. A fresh page, because the
    // first one's seeding runs again on every load of it.
    const soloPage = await context.newPage()
    await seedGarage(soloPage, false)
    const solo = await visitUnder(soloPage, 'solo')
    expect(solo.climbTrade).toBeUndefined()
    expect(['Zwift Concept Z1', 'Specialized Aethos S-Works']).not.toContain(await rank1(soloPage))
    await expect(climbTrade(soloPage)).toHaveCount(0)
  })
})

test.describe('wheel close call', () => {
  test('says disc or regular is a close call on rank 1\'s frame', async ({ page }) => {
    await seedRiderProfile(page, { weightKg: 75, heightCm: 175, powerW: 240, draftMode: 'race' })
    await visit(page, ROUTE)
    await expect(why(page)).toContainText(/Disc or regular wheels is a close call: the .+ is [\d.]+ s faster than the .+(heavier|lighter)\./)
  })
})
