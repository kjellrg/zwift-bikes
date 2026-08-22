import type { RouteWithMeta } from '../types/catalog'

/**
 * Restricts the lap selector to a sane range - Zwift races only rarely go
 * beyond this, and the underlying `estimateFinishTimeSec` model is a rough
 * average-grade approximation that isn't worth extrapolating further.
 */
export const MAX_LAPS = 15

/**
 * Ceiling on the total distance a lap count may produce: lead-in + laps x
 * lap distance stays within this (one lap is always allowed, so every
 * single-lap route - PRL Full at 173 km is the longest - stays rideable).
 *
 * As much cost control as product sense: recommend-endpoint CPU is linear in
 * total simulated distance, and before this cap `laps=15` on the longest
 * lappable route (Four Horsemen, ~90 km/lap) meant integrating ~1,347 km per
 * candidate combo - ~20s of Workers CPU for one request. Nothing real lives
 * up there: the longest curated event ride is ~40 km.
 */
export const MAX_TOTAL_DISTANCE_KM = 200

/**
 * The largest lap count `clampLaps` will honour on `route`: `MAX_LAPS`,
 * further reduced so the total ride fits `MAX_TOTAL_DISTANCE_KM`. Exported
 * for the route page's lap picker and the MCP tool text, so what is offered
 * and what is honoured come from one function and can't drift.
 */
export function maxLapsForRoute(route: RouteWithMeta): number {
  if (!route.lap) return 1
  if (!route.distance) return MAX_LAPS
  const byDistance = Math.floor((MAX_TOTAL_DISTANCE_KM - (route.leadInDistance ?? 0)) / route.distance)
  return Math.min(MAX_LAPS, Math.max(1, byDistance))
}

/**
 * Clamps a requested lap count to `1..maxLapsForRoute(route)`, and forces it
 * to exactly 1 for routes that aren't lap-based at all (`route.lap === false`
 * - point-to-point routes can only be ridden once).
 */
export function clampLaps(route: RouteWithMeta, laps: number | undefined): number {
  if (!laps || !Number.isFinite(laps)) return 1
  return Math.min(maxLapsForRoute(route), Math.max(1, Math.round(laps)))
}

export interface RouteTotals {
  /** The actual (clamped) lap count these totals were computed for. */
  laps: number
  /** Total ride distance in km: the one-time lead-in plus `laps` x the lap distance. */
  distanceKm: number
  /** Total elevation gain in m: the one-time lead-in plus `laps` x the lap elevation. */
  elevationM: number
  /** Lead-in distance in km, ridden once regardless of lap count (0 if the route has none). */
  leadInDistanceKm: number
  /** Lead-in elevation gain in m, ridden once regardless of lap count (0 if the route has none). */
  leadInElevationM: number
}

/**
 * Total distance/elevation for riding `laps` laps of `route`, including the
 * one-time lead-in (ridden once before the first lap, not repeated on
 * subsequent laps - see `Route.leadInDistance`/`leadInElevation` from
 * `zwift-data`).
 */
export function computeRouteTotals(route: RouteWithMeta, laps: number): RouteTotals {
  const effectiveLaps = clampLaps(route, laps)
  const leadInDistanceKm = route.leadInDistance ?? 0
  const leadInElevationM = route.leadInElevation ?? 0
  return {
    laps: effectiveLaps,
    distanceKm: leadInDistanceKm + route.distance * effectiveLaps,
    elevationM: leadInElevationM + route.elevation * effectiveLaps,
    leadInDistanceKm,
    leadInElevationM
  }
}
