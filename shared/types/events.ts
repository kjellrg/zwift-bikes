import type { RouteWithMeta } from './catalog'
import type { EventRace, EventRound, EventSeason, RaceCategoryGroup } from '../utils/events'

/**
 * API-response shapes for `/api/events/[season]`: the curated calendar
 * (whose schema and base types live in `shared/utils/events.ts`, inferred
 * from the zod schema) joined server-side to real route data.
 *
 * Hand-written rather than inferred because they describe what the server
 * returns, not what the data files contain - and they may reference catalog
 * types, which the events data module itself must never do (see the leaf
 * rule in `shared/utils/events.ts`). Importing base types from there is
 * type-only, so it costs the client bundle nothing.
 */

/**
 * The bits of a route the season calendar actually renders.
 *
 * Deliberately narrower than `RouteSummary`, which carries the route's full
 * measured elevation profile and per-surface segments - ~10 KB per route,
 * none of which a calendar row displays. Multiplied by a fully-announced
 * 24-race season that would be ~250 KB of payload for a table of names.
 */
export type EventRaceRoute = Pick<RouteWithMeta, 'slug' | 'name' | 'world' | 'worldName' | 'distance' | 'elevation'>

/** A category group joined to its route, as returned by `/api/events/[season]`. */
export interface EventRaceCategoryWithRoute extends RaceCategoryGroup {
  /** Absent when `routeSlug` is unset, or names a route the catalog doesn't have. */
  route?: EventRaceRoute
  /** Distance/elevation from this site's own route data, over this group's laps. */
  computed?: {
    laps: number
    distanceKm: number
    elevationM: number
  }
}

/** A race with every category group joined to its route. */
export interface EventRaceWithRoute extends Omit<EventRace, 'categories'> {
  categories: EventRaceCategoryWithRoute[]
}

export interface EventRoundWithRoutes extends Omit<EventRound, 'races'> {
  races: EventRaceWithRoute[]
}

export interface EventSeasonWithRoutes extends Omit<EventSeason, 'rounds'> {
  rounds: EventRoundWithRoutes[]
}
