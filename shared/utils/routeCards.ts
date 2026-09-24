import type { RouteSummary, TerrainCategory } from '../types/catalog'
import { routeSilhouette, type Silhouette } from './silhouette'

/**
 * A route as a listing draws it: its identity, the numbers a rider picks a
 * route by and filters on, and its Silhouette. Built on the server
 * (`/api/route-cards`) from the catalog listing, which carries every route's
 * full measured profile and surface stretches; a card keeps 48 heights and
 * its surface families instead, so the homepage can carry every route's card
 * in one small payload and filter it in the browser.
 */
export interface RouteCardData {
  slug: string
  name: string
  world: string
  worldName: string
  distance: number
  elevation: number
  climbRatio: number
  terrain: TerrainCategory
  eventOnly: boolean
  /** Whether any of it is gravel - the homepage's "Includes gravel". */
  gravel: boolean
  /** Whether any of it is cobbles - the homepage's "Includes cobbles". */
  cobble: boolean
  shape: Silhouette | undefined
}

/** A card a route page suggests next, and whether it is from another world than the page's. */
export interface RelatedRouteCardData extends RouteCardData {
  otherWorld: boolean
}

/** The card for a listed route - its lap alone, since the summary carries no lead-in. */
export function toRouteCard(route: RouteSummary): RouteCardData {
  return {
    slug: route.slug,
    name: route.name,
    world: route.world,
    worldName: route.worldName,
    distance: route.distance,
    elevation: route.elevation,
    climbRatio: route.terrain.climbRatio,
    terrain: route.terrain.category,
    eventOnly: route.eventOnly,
    gravel: route.surface.gravel > 0,
    cobble: route.surface.cobble > 0,
    shape: routeSilhouette(route, 1)
  }
}
