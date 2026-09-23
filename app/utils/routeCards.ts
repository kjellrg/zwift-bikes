import type { RouteSummary, TerrainCategory } from '../../shared/types/catalog'
import { routeSilhouette, type Silhouette } from '#shared/utils/silhouette'

/**
 * A route as a Discovery card draws it: its identity, the numbers a rider
 * picks a route by, and its Silhouette resampled to a card's needs. The
 * listing endpoint carries every route's full measured profile and surface
 * stretches; the homepage keeps only this, so its payload holds a few dozen
 * points per route instead of every measured one.
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
  shape: Silhouette | undefined
}

/** Points per card outline - an outline, not the measured detail. */
export const ROUTE_CARD_SAMPLES = 48

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
    shape: routeSilhouette(route, 1, { samples: ROUTE_CARD_SAMPLES })
  }
}
