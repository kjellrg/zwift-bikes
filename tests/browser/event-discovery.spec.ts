import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, hydrated, visitPage } from './support'

/**
 * The events Discovery pages (issue #216): the hub that lists Seasons and a
 * season page that lists its Races (see `CONTEXT.md`). Both rank nothing and
 * neither has a filter - a journey here asserts what a rider scans and what a
 * crawler is served, not a ranking.
 *
 * Upcoming, next and past are resolved post-mount from the browser's own
 * clock, because these pages are prerendered and a build-time answer would
 * ship frozen. So every journey pins the clock first, against the real
 * curated calendars (`shared/data/events/`).
 *
 * `setFixedTime` rather than `install`: only `Date` has to be deterministic
 * here, and freezing the timers with it would leave the app's own scheduling
 * waiting for a tick the test never grants.
 */

const SEASON = '/events/zrl-2026-27'
const ZRACING = '/events/zracing-2026'
/** Mid-round 1: week 1 has been run, week 2 is next, rounds 2-4 are unannounced. */
const DURING = new Date('2026-09-25T12:00:00Z')
/** Past every race in both curated seasons. */
const AFTER = new Date('2027-05-01T12:00:00Z')

const statusLine = (page: Page) => page.locator('p[aria-live="polite"]')
const raceCard = (page: Page, name: string | RegExp) => page.getByRole('link', { name })
const pastRaces = (page: Page) => page.getByRole('button', { name: /^Past races \(\d+\)$/ })
const pastSeasons = (page: Page) => page.getByRole('button', { name: /^Past seasons \(\d+\)$/ })
/**
 * A round tile on a season card, by its number and name - the hub's way into
 * one round of a season page. Matched loosely between the two, because a
 * round that is on now or over says so in a badge that sits between them.
 */
const roundTile = (page: Page, number: number, name: string) =>
  page.getByRole('link', { name: new RegExp(`^Round ${number}\\b.*${name}`) })

async function visitAt(page: Page, path: string, time: Date) {
  await page.clock.setFixedTime(time)
  await visitPage(page, path)
}

/**
 * One card box, by what is inside it. `UCard` stamps its root
 * `data-slot="root"` (Nuxt UI names every slot element that way), which is
 * the only handle on the card itself rather than on one of the nested divs
 * that also contain the text.
 */
const cardWith = (page: Page, contents: { has?: Locator, hasText?: string }): Locator =>
  page.locator('[data-slot="root"]').filter(contents)

test.describe('event discovery', () => {
  test('lists every series newest first, with the organiser behind each one', async ({ page }) => {
    await visitAt(page, '/events', DURING)
    await expectNoHorizontalOverflow(page)

    await expect(page.getByRole('heading', { level: 2, name: 'Zwift Racing League' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'ZRacing' })).toBeVisible()

    const season = page.getByRole('link', { name: 'Zwift Racing League 2026/27' })
    await expect(season).toHaveAttribute('href', SEASON)
    // The stat row a rider picks a season by, on the card itself.
    const card = cardWith(page, { has: season })
    await expect(card).toContainText('4 rounds')
    await expect(card).toContainText('24 races')
    await expect(card).toContainText('Round 1')
    await expect(card).toContainText('Fresh & Fast')
    // Each round tile is the way into that round of the season page.
    await expect(roundTile(page, 1, 'Fresh & Fast')).toHaveAttribute('href', `${SEASON}#round-1`)
    // We complement the organisers, so their own page is one click away.
    await expect(page.getByRole('link', { name: 'WTRL' })).toHaveAttribute('href', /wtrl/)

    // Nothing has finished yet at this clock, so nothing has collapsed away.
    await expect(pastSeasons(page)).toHaveCount(0)
    await season.click()
    await page.waitForURL(`**${SEASON}`)
  })

  test('collapses a season away once its last race has been run', async ({ page }) => {
    await visitAt(page, '/events', AFTER)
    // Both curated seasons are over, so the hub keeps them but out of the way.
    await expect(pastSeasons(page)).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Zwift Racing League', exact: true })).toHaveCount(0)
    await pastSeasons(page).click()
    const season = page.getByRole('link', { name: 'Zwift Racing League 2026/27' })
    await expect(season).toBeVisible()
    // A finished season is still a page: its races keep their rankings.
    await expect(season).toHaveAttribute('href', SEASON)
    // The series comes with it, and so does the organiser - who is named
    // nowhere else on the page once their last season is over.
    await expect(page.getByRole('heading', { level: 2, name: 'Zwift Racing League', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'WTRL' })).toHaveAttribute('href', /wtrl/)
  })

  test('takes a round tile to that round of the season page', async ({ page }) => {
    await visitAt(page, '/events', DURING)
    await roundTile(page, 3, 'Racecraft Rush').click()
    await page.waitForURL(`**${SEASON}#round-3`)
    await hydrated(page)
    // Landed at the round, and clear of the sticky header rather than under
    // it - the heading's own `scroll-mt`.
    const heading = page.getByRole('heading', { level: 2, name: 'Round 3: Racecraft Rush' })
    await expect(heading).toBeInViewport()
    expect((await heading.boundingBox())!.y).toBeGreaterThan(64)
  })

  test('drops a run round from the page, and its tile stops leading anywhere', async ({ page }) => {
    // ZRacing's August round finished on 6 September; its September round has
    // not. The run one is not on the calendar at all - no heading, and none
    // of the "all of this round's races have been run" it used to lead with.
    await visitAt(page, ZRACING, DURING)
    await expect(page.getByRole('heading', { level: 2, name: /Round 9/ })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /Round 8/ })).toHaveCount(0)
    // Its races are where run races live, under their own round.
    await pastRaces(page).click()
    await expect(page.getByRole('heading', { level: 3, name: 'Round 8: August: Makuri Madness' })).toBeVisible()

    // And its tile stops being a way in at all, rather than promising a round
    // it can no longer reach: the races are in that disclosure, which no link
    // can open. It says so and leaves them there.
    await visitAt(page, '/events', DURING)
    await expect(roundTile(page, 8, 'Makuri Madness')).toHaveCount(0)
    await expect(cardWith(page, { hasText: 'August: Makuri Madness' })).toContainText('Past')
    // The round being raced right now is still a way in, and says which it is.
    const ongoing = roundTile(page, 9, 'DURA-ACE')
    await expect(ongoing).toHaveAttribute('href', `${ZRACING}#round-9`)
    await expect(ongoing).toContainText('Ongoing')
    // A round still to come carries no badge: it is the default, and its
    // dates are on the tile already.
    const toCome = roundTile(page, 3, 'Racecraft Rush')
    await expect(toCome).not.toContainText('Ongoing')
    await expect(toCome).not.toContainText('Past')
  })

  test('shows the season round by round, with the next race marked and run ones collapsed', async ({ page }) => {
    await visitAt(page, SEASON, DURING)
    await expectNoHorizontalOverflow(page)

    // The header's own numbers: the whole calendar, not the part still to
    // come, and the days it spans end to end.
    const stats = page.locator('dl').first()
    await expect(stats).toContainText('Rounds')
    await expect(stats).toContainText('24')
    await expect(stats).toContainText('Tue 22 Sept - Tue 6 Apr')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zwift Racing League 2026/27 schedule')

    await expect(page.getByRole('heading', { level: 2, name: 'Round 1: Fresh & Fast' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Round 2: Team Tempo' })).toBeVisible()
    await expect(statusLine(page)).toHaveText(/^\d+ races found$/)

    // Week 1 has been run, so week 2 carries the Next badge and week 1 is gone
    // from the round.
    const next = raceCard(page, /Round 1 Week 2/)
    await expect(next).toContainText('Next')
    await expect(raceCard(page, /Round 1 Week 1/)).toHaveCount(0)

    await pastRaces(page).click()
    const completed = raceCard(page, /Round 1 Week 1/)
    await expect(completed).toContainText('Completed')
    // The same card as an upcoming race, under its own round heading - a race
    // does not lose its distance the day its date passes.
    await expect(completed).toContainText('km')
    await expect(page.getByRole('heading', { level: 3, name: 'Round 1: Fresh & Fast' })).toBeVisible()
  })

  test('lists an unannounced race as a card with no page behind it', async ({ page }) => {
    await visitAt(page, SEASON, DURING)
    // Round 2 is on the calendar with no format and no course yet, so it has
    // no page - `isRacePublishable`. The card says what is known and says the
    // rest is to come, rather than linking somewhere thin.
    await expect(raceCard(page, /Round 2 Week 1/)).toHaveCount(0)
    const card = cardWith(page, { hasText: 'Round 2 Week 1' })
    await expect(card).toContainText('Format TBC')
    await expect(card).toContainText('Route TBC')
    await expect(card).toContainText('Details to come')
  })

  test('reaches a race page from its card and comes back', async ({ page }) => {
    await visitAt(page, SEASON, DURING)
    await raceCard(page, /Round 1 Week 2/).click()
    await page.waitForURL('**/events/zrl-2026-27/round-1-week-2')
    await hydrated(page)
    await page.getByRole('link', { name: 'Zwift Racing League 2026/27 schedule' }).click()
    await page.waitForURL(`**${SEASON}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zwift Racing League 2026/27 schedule')
  })

  test('says a season is over rather than reporting nothing found', async ({ page }) => {
    await visitAt(page, SEASON, AFTER)
    // Not "0 races found" and not "No races match your filters": this page has
    // no filters, and a finished season is an answer.
    await expect(page.getByText('Every race this season has been run - check back when the next season is announced.')).toBeVisible()
    await expect(page.getByText('races found')).toHaveCount(0)
    // The disclosure holds the whole page here, so it is open on arrival.
    await expect(pastRaces(page)).toBeVisible()
    await expect(raceCard(page, /Round 1 Week 1/)).toContainText('Completed')
  })

  test('keeps a failed calendar fetch on screen with a retry', async ({ page }) => {
    // Two doors to close. A direct visit is answered during the server
    // render, where a route stub cannot reach the fetch at all - so this
    // arrives from the hub, client-side. And Nuxt serves that navigation's
    // data out of the route's extracted payload, so the page never asks the
    // API unless the payload is gone too.
    await visitAt(page, '/events', DURING)
    await page.route('**/_payload.json*', route => route.abort())
    await page.route('**/api/events/**', route => route.fulfill({ status: 500, body: '{}' }))
    await page.getByRole('link', { name: 'Zwift Racing League 2026/27' }).click()
    await page.waitForURL(`**${SEASON}`)

    const notice = page.getByRole('alert').filter({ hasText: 'Couldn\'t load races.' })
    await expect(notice).toBeVisible()
    await expect(raceCard(page, /Round 1 Week 2/)).toHaveCount(0)

    await page.unroute('**/api/events/**')
    await page.unroute('**/_payload.json*')
    const responded = page.waitForResponse(response => response.url().includes('/api/events/') && response.ok())
    await notice.getByRole('button', { name: 'Try again' }).click()
    await responded
    await expect(notice).toHaveCount(0)
    await expect(raceCard(page, /Round 1 Week 2/)).toContainText('Next')
  })

  test('serves real race links in the HTML a crawler reads', async ({ page, request }) => {
    await visitAt(page, SEASON, DURING)
    const html = await (await request.get(SEASON)).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        heading: doc.querySelector('h1')?.textContent?.trim(),
        raceLinks: [...doc.querySelectorAll('a[href^="/events/zrl-2026-27/"]')].map(link => link.getAttribute('href'))
      }
    }, html)
    expect(served.heading).toBe('Zwift Racing League 2026/27 schedule')
    // Round 1's five rankable races, every one a real destination in the
    // served markup - the calendar is not an empty grid awaiting hydration.
    // (Week 6 is run on an unlisted route, so it has no page - see below.)
    expect(served.raceLinks).toContain('/events/zrl-2026-27/round-1-week-1')
    expect(served.raceLinks.length).toBe(5)
  })
})
