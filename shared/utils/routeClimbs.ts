import type { Route } from 'zwift-data'
import { segments } from 'zwift-data'
import type { RouteClimb, RouteSegmentPlacement } from '../types/catalog'
import { getGeneratedRouteSurface } from '../data/routeSurfaces'

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
 * `segmentsOnRoute` positions are LAP-relative on almost every route, but
 * ride-relative (lead-in included) on a few - see `placementsAreRideRelative`
 * below and `RouteClimb.perLap`. On `lutscher` (13.7km lap, 10.8km lead-in,
 * ride-relative), the "Innsbruck KOM" segment appears twice: once at km
 * 3.1-10.6 (entirely inside the lead-in - ridden once, ever) and again at km
 * 16.8-24.2, which is km 6.0-13.4 once the lead-in is subtracted (inside the
 * lap - ridden once per lap).
 */
const segmentsBySlug = new Map(segments.map(segment => [segment.slug, segment]))

/**
 * Whether a route's `segmentsOnRoute` positions are measured from the ride
 * start (lead-in included) rather than the lap start. Detected from the
 * placements themselves: a position past the lap's own length can only be a
 * ride coordinate. Empirically 112 of 114 routes with a real lead-in and
 * placements are lap-relative (verified against measured surface data on the
 * six Alpe du Zwift host routes - issue #126: assuming ride-relative
 * everywhere shifted their placements up to 2.8km early, slicing the jungle's
 * dirt into the all-tarmac Alpe on segment pages); lutscher/lutscher-ccw
 * style routes, whose placements run past the lap, are the exception.
 *
 * Two signals, either sufficient:
 * 1. A placement past the lap's own length (only a ride coordinate can be
 *    there) - catches lutscher, whose lap KOM sits at ride km 16.8-24.2.
 * 2. The route's measured GPS trace covered the lead-in
 *    (`traceCoveredLeadIn`, recorded by the generation-time normalizer):
 *    trace and placements come from the same community ride, and every
 *    checked route's two conventions agree - catches lutscher-ccw, whose
 *    single lead-in KOM placement (ride km 2.9-8.6, inside the 8.88km
 *    lead-in) fits within the lap distance and would otherwise be
 *    undetectable.
 *
 * A ride-relative route with neither signal reads as lap-relative -
 * accepted: that failure mode misplaces by at most the lead-in on a route
 * shaped like no known example, while the old always-subtract rule misplaced
 * placements on ~198 routes. Shared by `getRouteClimbs` and
 * `getRouteSprints`, which must never disagree about a route's frame.
 */
export function placementsAreRideRelative(route: Route): boolean {
  const leadInKm = route.leadInDistance ?? 0
  if (leadInKm <= 0 || !route.segmentsOnRoute?.length) return false
  if (getGeneratedRouteSurface(route.slug)?.traceCoveredLeadIn) return true
  const toleranceKm = Math.max(0.3, route.distance * 0.01)
  return route.segmentsOnRoute.some(placement => placement.to > route.distance + toleranceKm)
}

export function getRouteClimbs(route: Route): RouteClimb[] {
  if (!route.segmentsOnRoute?.length) return []
  const leadInKm = route.leadInDistance ?? 0
  const rideRelative = placementsAreRideRelative(route)

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
    const perLap = !rideRelative || placement.from >= leadInKm
    const fromKm = rideRelative && perLap ? placement.from - leadInKm : placement.from

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

/**
 * `zwift-data`'s `segments` catalog also has real sprint segments (61 of
 * them, alongside the 45 climbs `getRouteClimbs` reads) - same
 * `segmentsOnRoute` cross-reference, but unlike climbs, a sprint with no
 * published `avgIncline`/`elevation` is kept as flat (`elevationM: 0`)
 * rather than skipped, since most sprints legitimately have no gradient
 * data at all (see the surrounding investigation in this repo's history).
 * Lives next to `getRouteClimbs` because the two share one per-route frame
 * decision (`placementsAreRideRelative`) and must never disagree about
 * whether a route's positions include the lead-in.
 */
export function getRouteSprints(route: Route): RouteSegmentPlacement[] {
  if (!route.segmentsOnRoute?.length) return []
  const leadInKm = route.leadInDistance ?? 0
  const rideRelative = placementsAreRideRelative(route)

  const sprints: RouteSegmentPlacement[] = []
  for (const placement of route.segmentsOnRoute) {
    const segment = segmentsBySlug.get(placement.segment)
    if (!segment || segment.type !== 'sprint') continue

    const lengthKm = placement.to - placement.from
    if (lengthKm <= 0) continue

    const elevationM = Math.max(0, segment.avgIncline !== undefined
      ? (segment.avgIncline / 100) * lengthKm * 1000
      : (segment.elevation ?? 0))
    const avgGradePercent = segment.avgIncline ?? (elevationM > 0 ? (elevationM / (lengthKm * 1000)) * 100 : 0)
    const perLap = !rideRelative || placement.from >= leadInKm
    const fromKm = rideRelative && perLap ? placement.from - leadInKm : placement.from

    sprints.push({
      name: segment.name,
      slug: segment.slug,
      type: 'sprint',
      fromKm,
      toKm: fromKm + lengthKm,
      lengthKm,
      elevationM,
      avgGradePercent,
      perLap
    })
  }

  return sprints.sort((a, b) => a.fromKm - b.fromKm)
}
