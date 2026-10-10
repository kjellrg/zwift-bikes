import { expect, test, type Page } from '@playwright/test'
import { visit, visitPage } from './support'

/**
 * World pages (#58): one per world, listing every route in it and then its
 * climbs and sprints, all in the server's HTML. The journeys check what a
 * crawler gets - every link, with nothing held back behind a control - and
 * that the world's name leads there from where the site says it: a route
 * page's breadcrumb and the homepage's "Browse by world" row.
 *
 * The listing is compared with `/api/worlds/{slug}`, the endpoint the page
 * renders from; `server/utils/worldListing.test.ts` holds that against the
 * catalog, and `server/utils/siteReach.test.ts` the crawl from `/`.
 */

interface WorldListing {
  world: { slug: string, name: string }
  routes: { slug: string }[]
  segments: { slug: string }[]
}

const WORLD = '/worlds/watopia'
const heading = (page: Page) => page.getByRole('main').getByRole('heading', { level: 1 })

test.describe('a World page without JavaScript', () => {
  // What a crawler reads: the served HTML, with nothing hydrated.
  test.use({ javaScriptEnabled: false })

  test('links every route and every segment of the world, with nothing to narrow or page', async ({ page, request }) => {
    const listing: WorldListing = await (await request.get('/api/worlds/watopia')).json()
    const response = await page.goto(WORLD)
    expect(response?.status()).toBe(200)

    const main = page.getByRole('main')
    await expect(heading(page)).toHaveText('Every Zwift route in Watopia')
    const hrefs = (prefix: string) => main.locator(`a[href^="${prefix}"]`).evaluateAll(links => links.map(link => link.getAttribute('href')))
    expect(await hrefs('/routes/')).toEqual(listing.routes.map(route => `/routes/${route.slug}`))
    expect(await hrefs('/segments/')).toEqual(listing.segments.map(segment => `/segments/${segment.slug}`))
    await expect(main.locator('li svg[data-silhouette]')).not.toHaveCount(0)

    // The whole world at once: no search box, no filter, no "Show more".
    await expect(main.getByRole('textbox')).toHaveCount(0)
    await expect(main.getByRole('combobox')).toHaveCount(0)
    await expect(main.getByRole('button')).toHaveCount(0)

    // Home > Watopia, visible and marked up.
    await expect(main.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'All routes' })).toHaveAttribute('href', '/')
    const trails = await page.locator('script[type="application/ld+json"]').evaluateAll(scripts => scripts
      .map(script => JSON.parse(script.textContent ?? '{}'))
      .filter(block => block['@type'] === 'BreadcrumbList'))
    expect(trails).toHaveLength(1)
    expect(trails[0].itemListElement.map((item: { name: string }) => item.name)).toEqual(['Home', 'Watopia'])
  })
})

test.describe('the way to a World page', () => {
  test('a route page\'s breadcrumb leads to its world, which lists the route', async ({ page }) => {
    await visit(page, '/routes/hilly-route')
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Watopia', exact: true }).click()
    await page.waitForURL(`**${WORLD}`)
    await expect(heading(page)).toHaveText('Every Zwift route in Watopia')
    await expect(page.getByRole('main').locator('a[href="/routes/hilly-route"]')).toHaveCount(1)
  })

  test('the homepage hero links every world, with its route count', async ({ page, request }) => {
    const { worlds }: { worlds: unknown[] } = await (await request.get('/api/route-cards')).json()
    await visitPage(page, '/')
    const row = page.getByRole('navigation', { name: 'Browse by world' })
    await expect(row.getByRole('link')).toHaveCount(worlds.length)
    const watopia = row.getByRole('link', { name: /^Watopia \d+$/ })
    await expect(watopia).toHaveAttribute('href', WORLD)
    await watopia.click()
    await page.waitForURL(`**${WORLD}`)
    await expect(heading(page)).toHaveText('Every Zwift route in Watopia')
  })
})
