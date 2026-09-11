import { expect, test, type Locator, type Page } from '@playwright/test'
import { hydrated, rerank, visit, visitPage } from './support'

/**
 * About and reporting (issue #215): the two Overlays that are also real
 * pages, and the hand-off that files a report without this site ever
 * receiving one. Journeys assert what a rider and a crawler get - a real
 * destination behind every opener, the report the form says it will send,
 * and the auto-captured Ride the page is the only thing that knows.
 *
 * Nothing here posts a report: the GitHub destination is asserted as an
 * `href`, never clicked, and the mail hand-off (`window.location.href` on
 * click) is left alone entirely.
 */

const ROUTE = '/routes/hilly-route'
const SPRINT = '/segments/fuego-flats'

const header = (page: Page) => page.getByRole('banner')
const menuToggle = (page: Page) => header(page).getByRole('button', { name: 'Open menu' })
const menu = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('link', { name: 'Routes', exact: true }) })
const aboutOverlay = (page: Page) => page.getByRole('dialog', { name: 'About ZwiftBikes' })
const reportOverlay = (page: Page) => page.getByRole('dialog', { name: 'Report an issue' })
/** The contextual opener under a ranking - one per list, see `ReportDataLink`. */
const reportLink = (page: Page) => page.getByRole('link', { name: 'Report it' })

/** The About entry, wherever this viewport keeps it - the header, or the menu opened for it. */
async function aboutEntry(page: Page, isMobile: boolean): Promise<Locator> {
  if (!isMobile) return header(page).getByRole('link', { name: 'About', exact: true })
  if (!(await menu(page).isVisible())) await menuToggle(page).click()
  await expect(menu(page)).toBeVisible()
  return menu(page).getByRole('link', { name: 'About', exact: true })
}

/** The report exactly as it would be sent, out of the form's own disclosure. */
async function sentText(page: Page) {
  const disclosure = reportOverlay(page).getByText('Show exactly what gets sent')
  await disclosure.click()
  return reportOverlay(page).locator('pre')
}

test.describe('about and reporting', () => {
  test('swaps About for the report form, leaving one dialog open', async ({ page, isMobile }) => {
    await visit(page, ROUTE)
    await (await aboutEntry(page, isMobile)).click()
    await expect(aboutOverlay(page)).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(ROUTE)

    await aboutOverlay(page).getByRole('link', { name: 'Report an issue' }).click()
    await expect(reportOverlay(page)).toBeVisible()
    // One at a time: two overlapping dialogs fight over the focus trap and
    // the scroll lock - see `openReportFromAbout`.
    await expect(aboutOverlay(page)).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(1)
    expect(new URL(page.url()).pathname).toBe(ROUTE)
  })

  test('opens the About page on a modifier click without disturbing the ranking', async ({ page, context, isMobile }) => {
    await visit(page, ROUTE)
    const entry = await aboutEntry(page, isMobile)
    await expect(entry).toHaveAttribute('href', '/about')
    const popupPromise = context.waitForEvent('page')
    await entry.click({ modifiers: ['ControlOrMeta'] })
    const popup = await popupPromise
    await popup.waitForURL('**/about')
    expect(new URL(page.url()).pathname).toBe(ROUTE)
    await expect(aboutOverlay(page)).toHaveCount(0)
    await popup.close()
  })

  test('seeds a route report with the bike and the Ride it was ranked for, and hands it to GitHub unsent', async ({ page }) => {
    await visit(page, ROUTE)
    // The Ride line is the APPLIED one, so the second lap has to be ranked
    // before it can be reported - the lap picker is a `USelectMenu`, whose
    // trigger is a button carrying the label.
    await rerank(page, async () => {
      await page.getByRole('button', { name: 'Laps' }).click()
      await page.getByRole('option', { name: '2 laps', exact: true }).click()
    })
    await reportLink(page).click()
    await expect(reportOverlay(page)).toBeVisible()

    // The link sat under the route's ranking, so the correction already names it.
    await expect(reportOverlay(page).getByLabel('Which bike, wheel or route?')).toHaveValue('Watopia Hilly Route')
    // ...and carries what only the page knows: the applied laps, power and
    // draft mode behind the list, which the URL alone never spells out.
    await expect(await sentText(page)).toContainText('Ride:     2 laps, 225 W, Solo')

    await reportOverlay(page).getByLabel('Short summary').fill('Watopia Hilly Route climbing looks low')
    await reportOverlay(page).getByLabel('What the site currently shows').fill('335 m')
    await reportOverlay(page).getByLabel('What it should show, and why').fill('The lap has more than that')
    await reportOverlay(page).getByLabel('Source').fill('https://zwiftinsider.com/route/hilly-route/')

    const href = await reportOverlay(page).getByRole('link', { name: 'Open on GitHub' }).getAttribute('href')
    const github = new URL(href!)
    expect(github.origin + github.pathname).toBe('https://github.com/kjellrg/zwift-bikes/issues/new')
    expect(github.searchParams.get('template')).toBe('data-correction.yml')
    expect(github.searchParams.get('title')).toBe('Watopia Hilly Route climbing looks low')
    expect(github.searchParams.get('item')).toBe('Watopia Hilly Route')
    expect(github.searchParams.get('app-context')).toContain('Ride:     2 laps, 225 W, Solo')
  })

  test('reports a sprint segment at the sprint power it was actually ranked at', async ({ page }) => {
    await visit(page, SPRINT)
    await reportLink(page).click()
    await expect(reportOverlay(page)).toBeVisible()
    // The rider's page power is 225 W; a sprint is a different effort, and a
    // report that said 225 W would send a maintainer after a phantom.
    await expect(await sentText(page)).toContainText('Ride:     Sprint segment, 600 W sprint power, Solo')
  })

  test('returns the keyboard to the link that opened the report', async ({ page }) => {
    await visit(page, ROUTE)
    await reportLink(page).focus()
    await page.keyboard.press('Enter')
    await expect(reportOverlay(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(reportOverlay(page)).toHaveCount(0)
    await expect(reportLink(page)).toBeFocused()
  })

  test('serves both pages to a crawler, with no address in the HTML', async ({ page, request }) => {
    await visitPage(page, '/about')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('About ZwiftBikes')
    await visitPage(page, '/report')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Report an issue')
    await hydrated(page)

    for (const [path, heading] of [['/about', 'About ZwiftBikes'], ['/report', 'Report an issue']] as const) {
      const html = await (await request.get(path)).text()
      const served = await page.evaluate((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        return {
          heading: doc.querySelector('h1')?.textContent?.trim(),
          reportLinks: [...doc.querySelectorAll('a[href="/report"]')].length,
          mailtoLinks: [...doc.querySelectorAll('a[href^="mailto:"]')].length
        }
      }, html)
      expect(served.heading).toBe(heading)
      // Both pages are prerendered, so any address in their markup would sit
      // in a static file for harvesters - see `reportEmailAddress`.
      expect(html).not.toContain('@zwiftbikes.com')
      expect(served.mailtoLinks).toBe(0)
    }

    // The About page's own report link, not just the footer's: it is the one
    // route a rider following the About copy takes.
    const aboutHtml = await (await request.get('/about')).text()
    expect(aboutHtml).toContain('href="/report"')
  })
})
