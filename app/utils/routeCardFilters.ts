import type { TerrainCategory } from '../../shared/types/catalog'
import type { RouteCardData } from '#shared/utils/routeCards'

/** The top of the homepage's distance slider, in km: a range ending here is open above. */
export const ROUTE_DISTANCE_MAX_KM = 120
/** The top of the homepage's elevation slider, in m: a range ending here is open above. */
export const ROUTE_ELEVATION_MAX_M = 2000

/** The homepage's route filters, as its controls hold them. */
export interface RouteCardFilters {
  /** What the rider typed, as typed. */
  search: string
  world?: string
  surface?: 'gravel' | 'cobble'
  distance: readonly [number, number]
  elevation: readonly [number, number]
  /** Any of these; none chosen is every terrain. */
  terrain: readonly TerrainCategory[]
}

export const NO_ROUTE_FILTERS: RouteCardFilters = {
  search: '',
  distance: [0, ROUTE_DISTANCE_MAX_KM],
  elevation: [0, ROUTE_ELEVATION_MAX_M],
  terrain: []
}

const withinRange = (value: number, [low, high]: readonly [number, number], max: number) =>
  (low <= 0 || value >= low) && (high >= max || value <= high)

/**
 * The cards the homepage's filters leave, in the order given (#262). The
 * homepage holds every route's card from its prerendered payload and filters
 * them here, so a filter change makes no request. The rules are the ones
 * `/api/routes` has always applied to the same controls: the name contains
 * the search in any case, and a slider at its end leaves that side open.
 */
export function filterRouteCards(cards: readonly RouteCardData[], filters: RouteCardFilters): RouteCardData[] {
  const search = filters.search.trim().toLowerCase()
  return cards.filter(card =>
    (!search || card.name.toLowerCase().includes(search))
    && (!filters.world || card.world === filters.world)
    && (!filters.surface || card[filters.surface])
    && withinRange(card.distance, filters.distance, ROUTE_DISTANCE_MAX_KM)
    && withinRange(card.elevation, filters.elevation, ROUTE_ELEVATION_MAX_M)
    && (!filters.terrain.length || filters.terrain.includes(card.terrain)))
}
