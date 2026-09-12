import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, ready, resolvedColor, tabTo, visitPage } from './support'

/**
 * Segment discovery (issue #211): the segments page as the way into a climb's
 * or a sprint's recommendation. Climbs and sprints are one list with one set
 * of filters but two rankings behind them - a sprint is ranked at sprint
 * power - so the journeys open one of each and check they landed on the right
 * kind of page, not merely on a page.
 *
 * Both projects run: the world groups reflow to one column on a phone. Waits
 * come from `support.ts`; the one abort below is the failure state itself
 * under test, never a shortcut.
 */

const TEMPLE_KOM = '/segments/temple-kom-from-fishing-village-side'

const searchBox = (page: Page) => page.getByRole('textbox', { name: 'Search segments' })
/** A `USelectMenu`'s trigger is a button carrying the filter's `aria-label`. */
const filter = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset' })
/** `DiscoveryStatus`'s live count line - "Finding segments…", then "N climbs and M sprints found". */
const statusLine = (page: Page) => page.locator('p[aria-live="polite"]')
const notice = (page: Page) => page.getByRole('alert')
const cards = (page: Page) => page.locator('a[href^="/segments/"]')
const worldHeadings = (page: Page) => page.getByRole('heading', { level: 2 })
const finishTime = (page: Page) => page.locator('section:has(#ride-recommendation-heading) p.tabular-nums').first()

/** Runs `action` and waits for the segment list the change asks for. */
async function refilter(page: Page, action: () => Promise<void>) {
  const responded = page.waitForResponse(response => response.url().includes('/api/segments'))
  await action()
  await responded
  await expect(statusLine(page)).not.toHaveText(/^Finding/)
}

/** Picks a filter option. The kind filter is client-side, so only the two server-side filters wait for a response. */
async function pickFilter(page: Page, name: string, option: string) {
  await filter(page, name).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await expect(filter(page, name)).toHaveText(option)
}

test.describe('segment discovery', () => {
  test('searches for a climb, opens it, and comes back to the same view', async ({ page }) => {
    await visitPage(page, '/segments')
    await refilter(page, () => searchBox(page).fill('temple kom'))
    await expect(statusLine(page)).toHaveText(/^\d+ climbs? and 0 sprints found$/)
    await pickFilter(page, 'Show', 'Climbs')
    await expect(page).toHaveURL(/[?&]q=temple\+kom/)
    await expect(page).toHaveURL(/[?&]kind=climb/)
    await expect(statusLine(page)).toHaveText(/^\d+ climbs? found$/)
    const shown = await cards(page).count()
    expect(shown).toBeGreaterThan(0)

    const opened = page.locator(`a[href="${TEMPLE_KOM}"]`)
    const name = await opened.locator('p').first().innerText()
    await opened.click()
    await page.waitForURL(`**${TEMPLE_KOM}`)
    await ready(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
    expect(await finishTime(page).innerText()).toMatch(/^\d{1,2}:\d{2}(:\d{2})?$/)

    await page.goBack()
    await expect(page).toHaveURL(/[?&]q=temple\+kom/)
    await expect(page).toHaveURL(/[?&]kind=climb/)
    await expect(searchBox(page)).toHaveValue('temple kom')
    await expect(filter(page, 'Show')).toHaveText('Climbs')
    await expect(cards(page)).toHaveCount(shown)
  })

  test('narrows to sprints, opens one, and ranks it at sprint power', async ({ page }) => {
    await visitPage(page, '/segments')
    await pickFilter(page, 'Show', 'Sprints')
    await expect(page).toHaveURL(/[?&]kind=sprint/)
    await expect(statusLine(page)).toHaveText(/^\d+ sprints? found$/)
    // Exact: the badge, not the "Sprint" in a name like "Alley Sprint".
    await expect(cards(page).first().getByText('Sprint', { exact: true })).toBeVisible()

    const opened = cards(page).first()
    const href = (await opened.getAttribute('href'))!
    const name = await opened.locator('p').first().innerText()
    await opened.click()
    await page.waitForURL(`**${href}`)
    await ready(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
    // A sprint is ranked at the rider's sprint power, not their steady power:
    // the rider strip marks the W/kg it applied as the sprint one, and that is
    // the whole reason a sprint is a different ranking, not a shorter climb.
    await expect(page.getByText(/W\/kg, sprint$/).first()).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/[?&]kind=sprint/)
    await expect(filter(page, 'Show')).toHaveText('Sprints')
  })

  test('says when nothing matched, and Reset brings the whole catalog back', async ({ page }) => {
    await visitPage(page, '/segments')
    const everything = await cards(page).count()
    expect(everything).toBeGreaterThan(0)

    await refilter(page, () => searchBox(page).fill('zzzzz'))
    await expect(page.getByText('No segments match your filters.')).toBeVisible()
    await expect(statusLine(page)).toHaveText('0 climbs and 0 sprints found')
    await expect(cards(page)).toHaveCount(0)
    await expect(worldHeadings(page)).toHaveCount(0)

    await refilter(page, () => resetButton(page).click())
    await expect(searchBox(page)).toHaveValue('')
    await expect(cards(page)).toHaveCount(everything)
    await expect(page).toHaveURL(/\/segments$/)
  })

  test('reaches the search, the filters and the first card from the skip link', async ({ page }) => {
    await visitPage(page, '/segments')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('main')).toBeFocused()

    await tabTo(page, page.getByRole('link', { name: 'Browse all routes' }))
    await tabTo(page, searchBox(page))
    await tabTo(page, filter(page, 'World'))
    await tabTo(page, filter(page, 'Show'))
    await tabTo(page, resetButton(page))
    const first = cards(page).first()
    const href = await first.getAttribute('href')
    await tabTo(page, first)
    await page.keyboard.press('Enter')
    await page.waitForURL(`**${href}`)
  })

  test('wraps a long climb name inside its own card', async ({ page }) => {
    await visitPage(page, '/segments')
    await refilter(page, () => searchBox(page).fill('temple kom'))
    const long = page.locator(`a[href="${TEMPLE_KOM}"]`)
    await expect(long).toBeVisible()
    await expect(long.getByText('Temple KOM from Fishing Village Side')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // A name that wraps must take more lines, never more width.
    const widths = await cards(page).evaluateAll(elements =>
      elements.map(element => Math.round(element.getBoundingClientRect().width)))
    expect(new Set(widths).size).toBe(1)
  })

  test('keeps the previous segments on screen when a filter change fails, and retries', async ({ page }) => {
    await visitPage(page, '/segments')
    const before = await cards(page).evaluateAll(links => links.map(link => link.getAttribute('href')))
    expect(before.length).toBeGreaterThan(0)

    // The one abort in this file: a failed refetch is what the journey is
    // about, and no real filter change can be made to fail on demand.
    await page.route('**/api/segments**', route => route.abort())
    await pickFilter(page, 'World', 'Watopia')
    await expect(notice(page)).toContainText('Couldn\'t load segments.')
    expect(await cards(page).evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(before)
    // The cards below are the previous filter's, so no count is reported for
    // the filter that failed - and none is announced.
    await expect(statusLine(page)).toHaveText('')

    await page.unroute('**/api/segments**')
    const responded = page.waitForResponse(response => response.url().includes('/api/segments') && response.ok())
    await notice(page).getByRole('button', { name: 'Try again' }).click()
    await responded
    await expect(notice(page)).toHaveCount(0)
    await expect(statusLine(page)).toHaveText(/found$/)
    expect(await cards(page).evaluateAll(links => links.map(link => link.getAttribute('href')))).not.toEqual(before)
  })

  test('serves real segment links in the HTML a crawler reads', async ({ page, request }) => {
    await visitPage(page, '/segments')
    const html = await (await request.get('/segments')).text()
    const served = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        heading: doc.querySelector('h1')?.textContent?.trim(),
        segmentLinks: [...doc.querySelectorAll('a[href^="/segments/"]')].map(link => link.getAttribute('href')),
        // Two links reach "/" in the HTML: the shell's Routes entry and this
        // page's cross-link. The cross-link is the one this page owns.
        routeLinks: [...doc.querySelectorAll('a[href="/"]')].map(link => link.textContent?.trim())
      }
    }, html)
    expect(served.heading).toBe('Zwift climbs & sprints')
    expect(served.segmentLinks.length).toBeGreaterThan(20)
    expect(served.segmentLinks).toContain(TEMPLE_KOM)
    expect(served.routeLinks).toContain('Browse all routes')
  })

  test('puts the cards on the dark ground, and lifts them off it on a switch to light', async ({ page }) => {
    await visitPage(page, '/segments')
    const cardGround = () => cards(page).first().locator('> *').first()
      .evaluate(element => getComputedStyle(element).backgroundColor)
    // A first visit is dark. The palette's deepest neutral, which `main.css`
    // re-points `--ui-bg` to in dark mode - not merely "whatever `--ui-bg`
    // is", which would hold in light mode too.
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    const darkGround = await resolvedColor(page, 'var(--ui-color-neutral-950)')
    expect(await cardGround()).toBe(darkGround)

    await page.getByRole('banner').getByRole('button', { name: 'Switch to light mode' }).click()
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    expect(await cardGround()).not.toBe(darkGround)
    await expectNoHorizontalOverflow(page)
  })
})
