import { describe, expect, it } from 'vitest'
import { getRouteBySlug, getRoutesWithMeta, getWorlds } from '../../shared/utils/catalog'
import { rideForRoute } from '../../shared/utils/recommendRide'
import { routeStatement } from '../../shared/utils/rideStatement'
import { filterRouteCards, NO_ROUTE_FILTERS, ROUTE_LIST_PAGE_SIZE } from '../../app/utils/routeCardFilters'
import { worldRouteCounts } from '../../app/utils/worldRouteCounts'
import { allRouteCards, relatedRouteCards } from './routeCardCatalog'
import { worldListing } from './worldListing'

/**
 * A crawl of the site's server-rendered links, from the homepage (#58).
 *
 * Measured on 10 Oct 2026, before the World pages: the homepage's HTML
 * linked 24 of the 293 cycling route pages (the first page of its grid;
 * "Show more" is a button and the world filter a select), and following
 * every link from there through each route page's four related rides
 * reached 180 of them, the deepest seven clicks down. The other 113 had no
 * link path from the homepage at all. The World pages are the fix, so this
 * models the links each kind of page puts in its HTML - from the same
 * sources the pages render them from - and walks them breadth first. With
 * the world links taken out, the same model gives the same 113 and seven.
 */
const SITE = 'https://zwiftbikes.com'

/** What the homepage's HTML links: its grid's first page with no filter set, and the "Browse by world" row. */
function homeLinks(): string[] {
  const cards = allRouteCards()
  return [
    ...filterRouteCards(cards, NO_ROUTE_FILTERS).slice(0, ROUTE_LIST_PAGE_SIZE).map(card => `/routes/${card.slug}`),
    ...worldRouteCounts(cards, getWorlds()).map(world => `/worlds/${world.slug}`)
  ]
}

/** What a World page's HTML links: every route in the world. */
const worldLinks = (slug: string) => worldListing(slug)!.routes.map(route => `/routes/${route.slug}`)

/** What a route page's HTML links: its breadcrumb trail and its four related rides. */
function routeLinks(slug: string): string[] {
  const route = getRouteBySlug(slug)!
  const crumbs = routeStatement({ ride: rideForRoute(route, 1), siteUrl: SITE }).heading.crumbs
  return [
    ...crumbs.flatMap(crumb => (crumb.to ? [crumb.to] : [])),
    ...relatedRouteCards(slug)!.map(card => `/routes/${card.slug}`)
  ]
}

function linksOf(path: string): string[] {
  if (path === '/') return homeLinks()
  const world = /^\/worlds\/([^/]+)$/.exec(path)
  if (world) return worldLinks(world[1]!)
  const route = /^\/routes\/([^/]+)$/.exec(path)
  if (route) return routeLinks(route[1]!)
  return []
}

/** Every page reached from `/`, with the fewest clicks it takes. */
function crawl(links: (path: string) => string[]): Map<string, number> {
  const depth = new Map([['/', 0]])
  const queue = ['/']
  while (queue.length) {
    const path = queue.shift()!
    for (const next of links(path)) {
      if (depth.has(next)) continue
      depth.set(next, depth.get(path)! + 1)
      queue.push(next)
    }
  }
  return depth
}

describe('a crawl from the homepage', () => {
  const routePaths = getRoutesWithMeta().map(route => `/routes/${route.slug}`)

  it('reaches every cycling route page within three clicks', () => {
    const depth = crawl(linksOf)
    expect(routePaths.filter(path => !depth.has(path))).toEqual([])
    expect(Math.max(...routePaths.map(path => depth.get(path)!))).toBeLessThanOrEqual(3)
  })

  it('reaches every World page in one click', () => {
    const depth = crawl(linksOf)
    for (const world of getWorlds()) expect(depth.get(`/worlds/${world.slug}`), world.slug).toBe(1)
  })

  it('reaches every route page in two clicks through the World pages alone', () => {
    // No grid and no related rides: the homepage's world row, then the
    // world's list. Every route is on exactly one World page.
    const depth = crawl(path => (path === '/' ? homeLinks().filter(link => link.startsWith('/worlds/')) : path.startsWith('/worlds/') ? linksOf(path) : []))
    expect(routePaths.filter(path => depth.get(path) !== 2)).toEqual([])
  })
})
