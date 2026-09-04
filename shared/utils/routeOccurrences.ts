import type { RouteClimb, RouteSegmentPlacement, RouteWithMeta } from '../types/catalog'

/**
 * Lap expansion of a route's named climbs and sprints, for the route and
 * race pages.
 *
 * IMPORTANT: this module is a leaf - it imports types only. The pages call
 * these functions in the browser, so anything reachable from here ships in
 * the client bundle. The placements themselves (`terrain.climbs`,
 * `terrain.sprints`) are computed server-side by `routeClimbs.ts`, which
 * needs `zwift-data`'s segment catalog and the route's measured surface data
 * to decide each route's placement frame; before this split, the pages
 * imported that code directly and dragged `routeSurfaces.generated.json`
 * plus zwift-data's route catalog (1.77 MB, 344 KB gzipped) into every route
 * page (issue #151). The same rule is documented for the events data in
 * `shared/utils/events.ts`, and `scripts/check-client-bundle.mjs` fails the
 * build if either payload ever reappears in a client chunk.
 */

export interface SegmentOccurrence {
  /** Position from the true start of the ride (lead-in included), across all laps ridden. */
  rideFromKm: number
  rideToKm: number
  /** 1-indexed lap this occurrence falls on. Unset for lead-in-only items (`perLap: false`), which never repeat. */
  lapNumber?: number
}

export interface RouteClimbOccurrence extends RouteClimb, SegmentOccurrence {}

/**
 * Expands any position-tagged, per-lap-repeating list (climbs, sprints - see
 * `RouteClimb`/`RouteSegmentPlacement`) into one entry per actual occurrence
 * for a given lap count - a `perLap` item shows up once per lap, positioned
 * at its real km on each lap, so riders can see e.g. "Innsbruck KOM" three
 * times on a 3-lap ride rather than just once. Shared by `expandClimbsForLaps`
 * and `expandSprintsForLaps`.
 */
export function expandOccurrencesForLaps<T extends { fromKm: number, toKm: number, perLap: boolean }>(
  items: T[],
  route: RouteWithMeta,
  laps: number
): (T & SegmentOccurrence)[] {
  const leadInKm = route.leadInDistance ?? 0
  const lapCount = Math.max(1, Math.floor(laps))

  const occurrences: (T & SegmentOccurrence)[] = []
  for (const item of items) {
    if (!item.perLap) {
      occurrences.push({ ...item, rideFromKm: item.fromKm, rideToKm: item.toKm })
      continue
    }
    for (let lap = 0; lap < lapCount; lap++) {
      const offsetKm = leadInKm + lap * route.distance
      // Only label which lap when more than one is actually being ridden -
      // "lap 1" of 1 is just noise.
      const lapNumber = lapCount > 1 ? lap + 1 : undefined
      occurrences.push({ ...item, lapNumber, rideFromKm: offsetKm + item.fromKm, rideToKm: offsetKm + item.toKm })
    }
  }

  return occurrences.sort((a, b) => a.rideFromKm - b.rideFromKm)
}

/**
 * Expands a route's climbs (as computed once, lap-relative, by
 * `getRouteClimbs`/`computeTerrain`) into one entry per actual occurrence for
 * a given lap count - see `expandOccurrencesForLaps`.
 */
export function expandClimbsForLaps(route: RouteWithMeta, laps: number): RouteClimbOccurrence[] {
  return expandOccurrencesForLaps(route.terrain.climbs, route, laps)
}

/** Expands a route's sprints (`getRouteSprints`/`computeTerrain`) into one entry per actual occurrence for a given lap count - see `expandOccurrencesForLaps`. */
export function expandSprintsForLaps(route: RouteWithMeta, laps: number): (RouteSegmentPlacement & SegmentOccurrence)[] {
  return expandOccurrencesForLaps(route.terrain.sprints, route, laps)
}
