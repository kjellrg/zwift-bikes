import type { Route } from 'zwift-data'
import { segments } from 'zwift-data'
import type { RouteClimb, RouteWithMeta } from '../types/catalog'

/**
 * `zwift-data` carries two fields nothing in this app used before: a route's
 * `segmentsOnRoute` (exact km position of every named segment it passes
 * through, in ride order) and a `segments` catalog with each named climb's
 * real distance/elevation/average gradient (sourced from Strava segment
 * data). Cross-referencing them gives real per-climb length + gradient for
 * a route, rather than the single whole-route `climbRatio` derived from
 * aggregate distance/elevation in `computeTerrain`.
 *
 * Coverage isn't universal - only routes that pass through a catalogued
 * climb segment get entries here (roughly 2 in 3 routes have *some*
 * segment placement data; not all of those segments are climbs, and not
 * every climb segment has a published average gradient).
 *
 * `segmentsOnRoute` positions are measured from the true start of a ride on
 * the route, lead-in included - e.g. on `lutscher` (13.7km lap, 10.8km
 * lead-in), the "Innsbruck KOM" segment appears twice: once at km 3.1-10.6
 * (entirely inside the lead-in - ridden once, ever) and again at km
 * 16.8-24.2, which is km 6.0-13.4 once the lead-in is subtracted (inside the
 * lap - ridden once per lap). See `RouteClimb.perLap`.
 */
const segmentsBySlug = new Map(segments.map(segment => [segment.slug, segment]))

export function getRouteClimbs(route: Route): RouteClimb[] {
  if (!route.segmentsOnRoute?.length) return []
  const leadInKm = route.leadInDistance ?? 0

  const climbs: RouteClimb[] = []
  for (const placement of route.segmentsOnRoute) {
    const segment = segmentsBySlug.get(placement.segment)
    if (!segment || segment.type !== 'climb') continue

    const lengthKm = placement.to - placement.from
    if (lengthKm <= 0) continue

    const elevationM = segment.avgIncline !== undefined
      ? (segment.avgIncline / 100) * lengthKm * 1000
      : segment.elevation
    if (!elevationM || elevationM <= 0) continue

    const avgGradePercent = segment.avgIncline ?? (elevationM / (lengthKm * 1000)) * 100
    const perLap = placement.from >= leadInKm
    const fromKm = perLap ? placement.from - leadInKm : placement.from

    climbs.push({
      name: segment.name,
      slug: segment.slug,
      fromKm,
      toKm: fromKm + lengthKm,
      lengthKm,
      elevationM,
      avgGradePercent,
      climbType: segment.climbType,
      perLap
    })
  }

  return climbs.sort((a, b) => a.fromKm - b.fromKm)
}

export interface RouteClimbOccurrence extends RouteClimb {
  /** Position from the true start of the ride (lead-in included), across all laps ridden. */
  rideFromKm: number
  rideToKm: number
  /** 1-indexed lap this occurrence falls on. Unset for lead-in-only climbs (`perLap: false`), which never repeat. */
  lapNumber?: number
}

export interface SegmentOccurrence {
  rideFromKm: number
  rideToKm: number
  lapNumber?: number
}

/**
 * Expands any position-tagged, per-lap-repeating list (climbs, sprints - see
 * `RouteClimb`/`RouteSegmentPlacement`) into one entry per actual occurrence
 * for a given lap count - a `perLap` item shows up once per lap, positioned
 * at its real km on each lap, so riders can see e.g. "Innsbruck KOM" three
 * times on a 3-lap ride rather than just once. Shared by `expandClimbsForLaps`
 * and `routeSegments.ts`'s `expandSprintsForLaps`.
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
