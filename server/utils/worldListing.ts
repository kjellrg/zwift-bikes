import type { SegmentSummary } from '../../shared/types/catalog'
import { getRoutesWithMeta, getWorlds } from '../../shared/utils/catalog'
import type { RouteCardData } from '../../shared/utils/routeCards'
import { getAllSegmentSummaries } from '../../shared/utils/routeSegments'
import { allRouteCards } from './routeCardCatalog'

/**
 * A route as a World page row draws it: the homepage's card, plus the share
 * of the lap that is gravel and the share that is cobbles, in percent. The
 * card's own `gravel`/`cobble` are flags set by any amount at all - right
 * for the homepage's "Includes gravel" filter, but as a row's surface cell
 * they would read "Includes gravel and cobbles" on 99 of Watopia's 110 rows.
 * The shares are what the twin's table prints and the route page's Fact row
 * states, so a row and the page it leads to agree.
 */
export interface WorldRouteRow extends RouteCardData {
  surface: { gravel: number, cobble: number }
}

/** Everything one World page lists (see **World page** in CONTEXT.md). */
export interface WorldListing {
  world: { slug: string, name: string }
  /** Every catalog route in the world, by name, as the homepage draws it. */
  routes: WorldRouteRow[]
  /** The world's climbs, most climbing first, then its sprints, by name - the segments index's order. */
  segments: SegmentSummary[]
}

const gainOf = (segment: SegmentSummary) => segment.measuredElevationM ?? segment.elevationM

/**
 * One world, read in full (#58): what its World page, the page's endpoint
 * (`/api/worlds/{slug}`) and its Twin all list, from one place so the three
 * cannot list different rides. Undefined for a slug that is not one of the
 * game's worlds.
 *
 * The routes are the homepage's cards, in the homepage's order (by name):
 * one ordering across every listing of routes. The segments come in the
 * order the segments index gives a world group - climbs by climbing gained,
 * most first, then sprints by name - so a world's climbs read the same on
 * both pages.
 */
export function worldListing(slug: string): WorldListing | undefined {
  const world = getWorlds().find(entry => entry.slug === slug)
  if (!world) return undefined
  const segments = getAllSegmentSummaries().filter(segment => segment.world === world.slug)
  const surfaces = new Map(getRoutesWithMeta().filter(route => route.world === world.slug).map(route => [route.slug, route.surface]))
  return {
    world: { slug: world.slug, name: world.name },
    routes: allRouteCards().filter(card => card.world === world.slug).map((card) => {
      const surface = surfaces.get(card.slug)!
      return { ...card, surface: { gravel: surface.gravel, cobble: surface.cobble } }
    }),
    segments: [
      ...segments.filter(segment => segment.type === 'climb').sort((a, b) => gainOf(b) - gainOf(a) || a.name.localeCompare(b.name)),
      ...segments.filter(segment => segment.type === 'sprint').sort((a, b) => a.name.localeCompare(b.name))
    ]
  }
}
