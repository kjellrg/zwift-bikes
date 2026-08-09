import type { RouteWithMeta } from '../types/catalog'

/**
 * Restricts the lap selector to a sane range - Zwift races only rarely go
 * beyond this, and the underlying `estimateFinishTimeSec` model is a rough
 * average-grade approximation that isn't worth extrapolating further.
 */
export const MAX_LAPS = 15

/**
 * Clamps a requested lap count to `1..MAX_LAPS`, and forces it to exactly 1
 * for routes that aren't lap-based at all (`route.lap === false` - point-to-
 * point routes can only be ridden once).
 */
export function clampLaps(route: RouteWithMeta, laps: number | undefined): number {
  if (!route.lap) return 1
  if (!laps || !Number.isFinite(laps)) return 1
  return Math.min(MAX_LAPS, Math.max(1, Math.round(laps)))
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
