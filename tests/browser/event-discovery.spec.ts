import { expect, test, type Locator, type Page } from '@playwright/test'
import { EVENTS_SERVER_DAY, expectNoHorizontalOverflow, hydrated, servedEventsDay, visitPage } from './support'

/**
 * The events Discovery pages (issues #216, #257, #276, #279): the hub that lists
 * Seasons and a season page that lists its Races (see `CONTEXT.md`). Both rank
 * nothing and neither has a filter - a journey here asserts what a rider scans
 * and what a crawler is served, not a ranking.
 *
 * Both list only what is still to be run, decided twice: the server renders
 * with its own day (a build's, once prerendered), and after load the
 * browser's own clock takes over (`useToday`). Neither is the real date here.
 * The dev server renders on `EVENTS_SERVER_DAY`, which `playwright.config.ts`
 * pins, and every journey pins the browser's clock to that day or a later
 * one - so what the served HTML holds and what the page shows after load are
 * both fixed, against the real curated calendars (`shared/data/events/`).
 *
 * `setFixedTime` rather than `install`: only `Date` has to be deterministic
 * here, and freezing the timers with it would leave the app's own scheduling
 * waiting for a tick the test never grants.
 */

const SEASON = '/events/zrl-2026-27'
const ZRACING = '/events/zracing-2026'
/**
 * Mid-round 1: week 1 has been run, week 2 is next, rounds 2-4 are unannounced.
 * ZRacing's August round is over, and September's third stage is mid-window.
 */
const DURING = new Date(`${EVENTS_SERVER_DAY}T12:00:00Z`)
/** The day after ZRacing's September stage 3 closed (Sun 27 Sept). */
const STAGE_3_RUN = new Date('2026-09-28T00:30:00Z')
/** Past every race in both curated seasons. */
const AFTER = new Date('2027-05-01T12:00:00Z')

/** A race's row on a season page, by the name it is listed under ("Week 2", "Stage 3") - rows are the items of a round section's list. */
const raceRow = (page: Page, name: RegExp) => page.locator('main section ol > li').filter({ hasText: name })
/** The row's way into its race page - the whole row, and absent for a race with no page yet. */
const raceLink = (page: Page, name: RegExp) => raceRow(page, name).getByRole('link')
/** The header's counts of what is left, above the calendar. */
const headerStats = (page: Page) => page.locator('main ul').first()
/** A round with nothing announced, on its one line under "Not announced yet" - by its `#round-N` anchor. */
const unannouncedRound = (page: Page, number: number) => page.locator(`main li#round-${number}`)
/** Whatever used to hold, or label, what has been run. None of it is on either page any more. */
async function expectNothingLabelledPast(page: Page) {
  await expect(page.getByRole('button', { name: /^Past (races|seasons)/ })).toHaveCount(0)
  await expect(page.getByText(/^(Past|Completed)$/)).toHaveCount(0)
}
/**
 * A round tile on a season card, by its number and name - the hub's way into
 * one round of a season page. Matched loosely between the two, because a
 * round's state ("Ongoing", "To come") is a text tag that sits between them.
 */
const roundTile = (page: Page, number: number, name: string) =>
  page.getByRole('link', { name: new RegExp(`^Round ${number}(?!\\d).*${name}`) })

async function visitAt(page: Page, path: string, time: Date) {
  await page.clock.setFixedTime(time)
  await visitPage(page, path)
}

/** A season card on the hub, by what is inside it. */
const seasonCard = (page: Page, contents: { has?: Locator, hasText?: string }): Locator =>
  page.locator('article').filter(contents)
/** A round tile, linked or not, by the text inside it. */
const tileWith = (page: Page, text: string): Locator => page.locator('article li').filter({ hasText: text })

test.describe('event discovery', () => {
  // A dev server already on the port is reused, and one not started by
  // `playwright.config.ts` renders on the real date. Say so once, up front,
  // rather than let every journey fail against the wrong calendar day.
  test.beforeAll(async ({ playwright }, testInfo) => {
    const request = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL })
    const day = servedEventsDay(await (await request.get(SEASON)).text())
    await request.dispose()
    expect(day, `the dev server must be started with EVENTS_TODAY=${EVENTS_SERVER_DAY} - stop the one on the port and let Playwright start it`).toBe(EVENTS_SERVER_DAY)
  })

  test('lists every series newest first, with the organiser behind each one', async ({ page }) => {
    await visitAt(page, '/events', DURING)
    await expectNoHorizontalOverflow(page)

    await expect(page.getByRole('heading', { level: 2, name: 'Zwift Racing League' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'ZRacing' })).toBeVisible()

    const season = page.getByRole('link', { name: 'Zwift Racing League 2026/27' })
    await expect(season).toHaveAttribute('href', SEASON)
    // The stat row a rider picks a season by, on the card itself.
    const card = seasonCard(page, { has: season })
    await expect(card).toContainText('4 rounds')
    await expect(card).toContainText('24 races')
    await expect(card).toContainText('Round 1')
    await expect(card).toContainText('Fresh & Fast')
    // Each round tile is the way into that round of the season page.
    await expect(roundTile(page, 1, 'Fresh & Fast')).toHaveAttribute('href', `${SEASON}#round-1`)
    // We complement the organisers, so their own page is one click away.
    await expect(page.getByRole('link', { name: 'WTRL' })).toHaveAttribute('href', /wtrl/)

    // A round's state is a text tag, never a coloured badge.
    await expect(roundTile(page, 1, 'Fresh & Fast')).toContainText('Ongoing')
    await expect(roundTile(page, 2, 'Team Tempo')).toContainText('To come')

    // The next race is one strip with a link that asks the question.
    const next = page.getByRole('region', { name: 'Next race' })
    await expect(next).toBeVisible()
    await expect(next.getByRole('link', { name: 'Fastest bike for it' })).toHaveAttribute('href', /^\/events\/[^/]+\/[^/]+$/)

    await expectNothingLabelledPast(page)
    await season.click()
    await page.waitForURL(`**${SEASON}`)
  })

  test('leaves a season off the hub once its last race has been run', async ({ page }) => {
    await visitAt(page, '/events', AFTER)
    // Both curated seasons are over: neither they nor their series are
    // listed, and the page says why it is empty rather than standing bare.
    await expect(page.getByText('No races are left to run on the calendars we cover.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Zwift Racing League 2026/27' })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'Zwift Racing League', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'ZRacing', exact: true })).toHaveCount(0)
    await expectNothingLabelledPast(page)
  })

  test('takes a round tile to that round of the season page', async ({ page }) => {
    await visitAt(page, '/events', DURING)
    await roundTile(page, 3, 'Racecraft Rush').click()
    await page.waitForURL(`**${SEASON}#round-3`)
    await hydrated(page)
    // Nothing of round 3 is announced, so it is one line under "Not
    // announced yet" - and that line is where the link lands, clear of the
    // sticky header rather than under it: its own `scroll-mt`.
    const line = unannouncedRound(page, 3)
    await expect(line).toContainText('Round 3: Racecraft Rush')
    await expect(line).toBeInViewport()
    expect((await line.boundingBox())!.y).toBeGreaterThan(64)
  })

  test('drops a run round from the season page, and its tile from the hub', async ({ page }) => {
    // ZRacing's August round finished on 6 September; its September round has
    // not. The run one is not on the calendar at all - no heading, no rows.
    await visitAt(page, ZRACING, DURING)
    await expect(page.getByRole('heading', { level: 2, name: /Round 9/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Round 8/ })).toHaveCount(0)
    await expect(page.locator('a[href^="/events/zracing-2026/stage-"]')).toHaveCount(0)
    // September's first two stages have been run; the third is mid-window
    // and still listed, and is the next race.
    await expect(page.locator('a[href="/events/zracing-2026/september-stage-1"]')).toHaveCount(0)
    await expect(page.locator('a[href="/events/zracing-2026/september-stage-2"]')).toHaveCount(0)
    await expect(raceRow(page, /Stage 3/)).toContainText('Next race')
    await expectNothingLabelledPast(page)

    // On the hub its tile is gone too, rather than standing there as "Past".
    await visitAt(page, '/events', DURING)
    await expect(tileWith(page, 'August: Makuri Madness')).toHaveCount(0)
    // The round being raced right now is still a way in, and says which it is.
    const ongoing = roundTile(page, 9, 'DURA-ACE')
    await expect(ongoing).toHaveAttribute('href', `${ZRACING}#round-9`)
    await expect(ongoing).toContainText('Ongoing')
    // A round still to come says so in the same quiet text.
    const toCome = roundTile(page, 3, 'Racecraft Rush')
    await expect(toCome).toContainText('To come')
    await expect(toCome).not.toContainText('Ongoing')
    await expectNothingLabelledPast(page)
  })

  test('drops a race that ends after the page was rendered, from the rider\'s own clock', async ({ page, request }) => {
    // The server renders on a day stage 3 is mid-window, so the served page
    // lists it as the next race.
    const html = await (await request.get(ZRACING)).text()
    expect(html).toContain('href="/events/zracing-2026/september-stage-3"')
    // The browser's clock is the day after its window closed, which is what
    // the page goes by once loaded: stage 3 goes and stage 4 becomes the next race.
    await visitAt(page, ZRACING, STAGE_3_RUN)
    await expect(raceRow(page, /Stage 4/)).toContainText('Next race')
    await expect(raceRow(page, /Stage 3/)).toHaveCount(0)
    await expect(page.locator('a[href="/events/zracing-2026/september-stage-3"]')).toHaveCount(0)

    // A week-long stage stays listed to the end of its last day.
    await visitAt(page, ZRACING, new Date('2026-09-27T23:30:00Z'))
    await expect(raceRow(page, /Stage 3/)).toContainText('Next race')
  })

  test('shows the season round by round, with the next race marked and run ones gone', async ({ page }) => {
    await visitAt(page, SEASON, DURING)
    await expectNoHorizontalOverflow(page)

    // The header counts what is left - week 1 has been run - and says how
    // far the calendar runs.
    await expect(headerStats(page)).toHaveText(/^5 races left in Round 1\s*18 more in Rounds 2-4\s*Calendar runs to Tue 6 Apr$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zwift Racing League 2026/27 schedule')
    // No search-result voice: this page has no filters.
    await expect(page.getByText(/races? found/)).toHaveCount(0)

    await expect(page.getByRole('heading', { level: 2, name: 'Round 1: Fresh & Fast' })).toBeVisible()

    // Week 1 has been run, so week 2 is marked the next race and week 1 is
    // nowhere on the page - not in its round, and not tucked away below.
    // Under its round's heading a row is named by its week alone.
    const next = raceRow(page, /Week 2/)
    await expect(next).toContainText('Next race')
    await expect(next).not.toContainText('Round 1 Week 2')
    await expect(raceLink(page, /Week 2/)).toHaveAttribute('href', '/events/zrl-2026-27/round-1-week-2')
    // A schedule row draws its primary route's Silhouette, as every listing does.
    await expect(next.locator('svg[data-silhouette]')).toHaveCount(1)
    await expect(raceRow(page, /Week 1/)).toHaveCount(0)
    await expect(page.locator('a[href="/events/zrl-2026-27/round-1-week-1"]')).toHaveCount(0)
    await expectNothingLabelledPast(page)
  })

  test('makes the whole row of a race with a page its one way in', async ({ page }) => {
    await visitAt(page, SEASON, DURING)
    const row = raceRow(page, /Week 2/)
    // One link, named for the race rather than for the cue it shows, and
    // no link inside it. The name is the race's full one, which holds the
    // "Week 2" the row shows: a link is heard away from its round's heading.
    await expect(row.getByRole('link')).toHaveCount(1)
    await expect(row.locator('a a')).toHaveCount(0)
    const link = raceLink(page, /Week 2/)
    await expect(link).toHaveAccessibleName(/^Round 1 Week 2, Tue 29 Sept?\b.*Fastest bike for it$/)
    await expect(link).toHaveAttribute('href', '/events/zrl-2026-27/round-1-week-2')

    // Each course line carries its distance and climbing together - the
    // organiser's figures, one line per group since A/B and C/D ride
    // different lap counts.
    await expect(row).toContainText('A/B: Innsbruckring, Innsbruck · 35.4 km / 309 m')
    await expect(row).toContainText('C/D: Innsbruckring, Innsbruck · 26.6 km / 232 m')

    // Hovering tints the row and underlines the cue it shows - where there
    // is a pointer that hovers at all.
    if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
      const cue = row.getByText('Fastest bike for it')
      const resting = await link.evaluate(element => getComputedStyle(element).backgroundColor)
      await expect(cue).toHaveCSS('text-decoration-line', 'none')
      await link.hover()
      await expect(link).not.toHaveCSS('background-color', resting)
      await expect(cue).toHaveCSS('text-decoration-line', 'underline')
    }

    // From the keyboard it shows the focus ring.
    await link.focus()
    await expect(link).toHaveCSS('outline-style', 'solid')

    // And a click anywhere on it - here its course line, nowhere near the
    // cue - opens the race.
    await row.getByText('A/B: Innsbruckring').click()
    await page.waitForURL('**/events/zrl-2026-27/round-1-week-2')
  })

  test('keeps a race on a course we cannot rank as a plain row saying why', async ({ page }) => {
    await visitAt(page, SEASON, DURING)
    // Week 6 runs on one of WTRL's unlisted routes: nothing to rank, so no page.
    const row = raceRow(page, /Week 6/)
    await expect(row.getByRole('link')).toHaveCount(0)
    await expect(row).toContainText('ZRL Exclusive Route · 24.0 km / 284 m')
    await expect(row).toContainText('this course isn\'t in our route data')
    // Not a destination, so it does not answer a pointer as one.
    const resting = await row.evaluate(element => getComputedStyle(element.firstElementChild!).backgroundColor)
    await row.hover()
    expect(await row.evaluate(element => getComputedStyle(element.firstElementChild!).backgroundColor)).toBe(resting)
  })

  test('lists a round with nothing announced as one line, not a row per race', async ({ page }) => {
    await visitAt(page, SEASON, DURING)
    // Round 1 has what is left of it race by race: weeks 2-6, week 6 a row
    // too although it can't be ranked.
    const round1 = page.locator('main section').filter({ has: page.getByRole('heading', { level: 2, name: 'Round 1: Fresh & Fast' }) })
    await expect(round1.locator('ol > li')).toHaveCount(5)
    await expect(round1.locator('ol > li').first()).toContainText('Week 2')
    await expect(round1.locator('ol > li').last()).toContainText('Week 6')

    // Rounds 2-4 have dates and nothing else, so each is one line under a
    // heading that counts their races - no heading per round, no placeholder rows.
    const notAnnounced = page.locator('main section').filter({ has: page.getByRole('heading', { level: 2, name: 'Not announced yet' }) })
    await expect(notAnnounced).toContainText('18 races')
    await expect(notAnnounced.locator('li')).toHaveCount(3)
    const round2 = unannouncedRound(page, 2)
    await expect(round2).toContainText('Round 2: Team Tempo')
    await expect(round2).toContainText('6 races, Tue 17 Nov - Tue 22 Dec')
    await expect(round2).toContainText('Routes to come from WTRL')
    await expect(unannouncedRound(page, 4)).toContainText('Round 4: Final Charge')
    await expect(page.getByRole('heading', { name: /^Round [234]/ })).toHaveCount(0)
    await expect(page.getByText('Format to come')).toHaveCount(0)
  })

  test('counts what is left from the rider\'s own clock once loaded', async ({ page, request }) => {
    // Served on a day week 2 is still to come...
    const html = await (await request.get(SEASON)).text()
    expect(html).toMatch(/>5<\/span>\s*races left in Round 1/)
    // ...and read on a day it has been run: one fewer left, and the row gone.
    await visitAt(page, SEASON, new Date('2026-09-30T12:00:00Z'))
    await expect(headerStats(page)).toHaveText(/^4 races left in Round 1\s*18 more in Rounds 2-4/)
    await expect(raceRow(page, /Week 2/)).toHaveCount(0)
    await expect(raceRow(page, /Week 3/)).toContainText('Next race')
  })

  test('reaches a race page from its row and comes back', async ({ page }) => {
    await visitAt(page, SEASON, DURING)
    await raceLink(page, /Week 2/).click()
    await page.waitForURL('**/events/zrl-2026-27/round-1-week-2')
    await hydrated(page)
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Zwift Racing League 2026/27' }).click()
    await page.waitForURL(`**${SEASON}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zwift Racing League 2026/27 schedule')
  })

  test('says a season is over, and points to the hub, rather than reporting nothing found', async ({ page }) => {
    await visitAt(page, SEASON, AFTER)
    // Not "0 races found" and not "No races match your filters": this page has
    // no filters, and a finished season is an answer.
    await expect(page.getByText('Every race this season has been run')).toBeVisible()
    await expect(page.getByText('races found')).toHaveCount(0)
    // Nothing that has been run is listed, so there is no round and no row.
    await expect(page.getByRole('heading', { level: 2, name: /^Round/ })).toHaveCount(0)
    await expect(page.locator('main section ol > li')).toHaveCount(0)
    await expectNothingLabelledPast(page)
    // It points to where the races still to come are.
    await page.getByRole('link', { name: 'events page' }).click()
    await page.waitForURL('**/events')
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
    await expect(raceRow(page, /Week 2/)).toHaveCount(0)

    await page.unroute('**/api/events/**')
    await page.unroute('**/_payload.json*')
    const responded = page.waitForResponse(response => response.url().includes('/api/events/') && response.ok())
    await notice.getByRole('button', { name: 'Try again' }).click()
    await responded
    await expect(notice).toHaveCount(0)
    await expect(raceRow(page, /Week 2/)).toContainText('Next race')
  })

  test('serves real race links in the HTML a crawler reads, and none that has been run', async ({ page, request }) => {
    await visitAt(page, SEASON, DURING)
    const html = await (await request.get(SEASON)).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        heading: doc.querySelector('h1')?.textContent?.trim(),
        raceLinks: [...doc.querySelectorAll('a[href^="/events/zrl-2026-27/"]')].map(link => link.getAttribute('href')),
        rows: [...doc.querySelectorAll('main section ol > li')].map(row => row.textContent ?? ''),
        stats: [...doc.querySelector('main ul')?.children ?? []].map(stat => stat.textContent?.replace(/\s+/g, ' ').trim()),
        text: doc.querySelector('main')?.textContent ?? ''
      }
    }, html)
    expect(served.heading).toBe('Zwift Racing League 2026/27 schedule')
    // Round 1's rankable races still to run on the server's day, weeks 2-5,
    // every one a real destination in the served markup - the calendar is not
    // an empty grid awaiting hydration. (Week 6 is run on an unlisted route,
    // so it has no page.)
    expect(served.raceLinks).toEqual([2, 3, 4, 5].map(week => `/events/zrl-2026-27/round-1-week-${week}`))
    // Week 1 was run on Tue 22 Sept, before the server's day, so the served
    // page already leaves it out and does not count it: a crawler never sees it.
    expect(served.rows).toHaveLength(5)
    expect(served.rows.join(' ')).not.toContain('Week 1')
    expect(served.stats).toEqual(['5 races left in Round 1', '18 more in Rounds 2-4', 'Calendar runs to Tue 6 Apr'])
    expect(served.text).not.toMatch(/Past races|Completed/)
  })
})
