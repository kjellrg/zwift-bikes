import { expect, test, type Page } from '@playwright/test'
import { EVENTS_SERVER_DAY, servedEventsDay, visit } from './support'

/**
 * A Race that has been run keeps its page (issue #277): a link a rider shared
 * still lands, on a page that says the race has been run and points to the
 * season's next race and to the route, while the ranking below it works as
 * before. The site stops promoting it: the page is noindex, and it leaves the
 * sitemap and the prerender list (unit-tested in `shared/utils/events.test.ts`
 * through `getIndexedRaces`, which both read).
 *
 * "Has been run" is decided the way the events Discovery pages decide it
 * (`event-discovery.spec.ts`): on the server's day, which the dev server pins
 * to `EVENTS_SERVER_DAY`, and after load on the browser's clock, which each
 * journey pins with `setFixedTime` to that day or a later one.
 */

/** Run on Tue 22 Sept, before the server's day. */
const RUN = '/events/zrl-2026-27/round-1-week-1'
/** Raced on Tue 29 Sept, after the server's day. */
const TO_RUN = '/events/zrl-2026-27/round-1-week-2'
/** The last race ZRacing 2026 has, a stage that closes on Sun 4 Oct. */
const LAST_STAGE = '/events/zracing-2026/september-stage-4'

/** The day after round 1 week 2 was raced. */
const AFTER_WEEK_2 = new Date('2026-09-30T12:00:00Z')
/** Past every race in both curated seasons. */
const AFTER = new Date('2027-05-01T12:00:00Z')

const notice = (page: Page) => page.getByRole('region', { name: 'This race has been run' })

/** What a crawler reads off a served page: its robots rule, its share card, and the notice if there is one. */
async function served(page: Page, html: string) {
  return page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const notice = doc.querySelector('[aria-label="This race has been run"]')
    const heading = doc.querySelector('h1')
    // The dev server marks every page noindex, nofollow (it is not the site),
    // and keeps what production would say beside it; a page's own rule
    // replaces both, which is the one a run race's page sets.
    const robots = doc.querySelector('meta[name="robots"]')
    return {
      robots: robots?.getAttribute('data-production-content') ?? robots?.getAttribute('content'),
      ogImage: doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
      notice: notice?.textContent?.replace(/\s+/g, ' ').trim(),
      noticeLinks: [...notice?.querySelectorAll('a') ?? []].map(link => ({ text: link.textContent?.trim(), href: link.getAttribute('href') })),
      noticeBeforeHeading: Boolean(notice && heading && notice.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING),
      crumbs: doc.querySelector('nav[aria-label="Breadcrumb"]')?.textContent ?? ''
    }
  }, html)
}

test.describe('a race that has been run', () => {
  test.beforeAll(async ({ playwright }, testInfo) => {
    const request = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL })
    const day = servedEventsDay(await (await request.get(RUN)).text())
    await request.dispose()
    expect(day, `the dev server must be started with EVENTS_TODAY=${EVENTS_SERVER_DAY} - stop the one on the port and let Playwright start it`).toBe(EVENTS_SERVER_DAY)
  })

  test('is served noindex, saying so above the title and pointing onwards', async ({ page, request }) => {
    const response = await request.get(RUN)
    // Not a 404 and not a redirect: the URL a rider shared still answers.
    expect(response.status()).toBe(200)
    expect(response.headers()['x-robots-tag']).toBe('noindex, follow')
    const html = await served(page, await response.text())

    // The server decides it on its own day, so the rule is in the HTML itself.
    // Its links are still followed: they are where the rider should go next.
    expect(html.robots).toBe('noindex, follow')
    expect(html.noticeBeforeHeading).toBe(true)
    expect(html.notice).toContain('Round 1 Week 1 was raced on Tue 22 Sept')
    expect(html.notice).toContain('still holds for this route under Race of Truth rules')
    expect(html.noticeLinks).toEqual([
      { text: 'Round 1 Week 2, Tue 29 Sept', href: TO_RUN },
      { text: 'Fastest bike for Montmartre Mixer', href: '/routes/montmartre-mixer' }
    ])
    // The notice says it; the breadcrumb no longer does.
    expect(html.crumbs).not.toContain('Completed')
    // The page is not prerendered, where its generated card would be made, so
    // it takes the site's own card rather than one whose image was never built.
    expect(html.ogImage).toMatch(/\/og-image\.png$/)
  })

  test('is not what a race still to run is served as', async ({ page, request }) => {
    const html = await served(page, await (await request.get(TO_RUN)).text())
    expect(html.robots).toMatch(/^index, follow/)
    expect(html.notice).toBeUndefined()
    expect(html.ogImage).not.toMatch(/\/og-image\.png$/)
  })

  test('says so after load once the rider\'s clock has passed it, and still ranks', async ({ page }) => {
    await page.clock.setFixedTime(AFTER_WEEK_2)
    await visit(page, TO_RUN)
    await expect(notice(page)).toContainText('Round 1 Week 2 was raced on Tue 29 Sept')
    const next = notice(page).getByRole('link', { name: 'Round 1 Week 3, Tue 6 Oct' })
    await expect(next).toHaveAttribute('href', '/events/zrl-2026-27/round-1-week-3')
    // The ranking under it is the one it always was.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Round 1 Week 2: Innsbruckring$/)
    await expect(page.getByRole('table').first()).toBeVisible()

    await next.click()
    await page.waitForURL('**/events/zrl-2026-27/round-1-week-3')
    await expect(notice(page)).toHaveCount(0)
  })

  test('points to the events hub once its season has nothing left to run', async ({ page }) => {
    await page.clock.setFixedTime(AFTER)
    await visit(page, LAST_STAGE)
    await expect(notice(page)).toContainText('Every race this season has been run.')
    await notice(page).getByRole('link', { name: 'Races still to come' }).click()
    await page.waitForURL('**/events')
  })
})
