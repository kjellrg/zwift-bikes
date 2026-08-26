import type { RouteClimb, RouteElevationPoint, RouteWithMeta } from '../../types/catalog'
import type { PhysicsSurface, RouteGeometry, RouteGeometryPoint, RouteSurfaceSegment } from '../../types/physics'
import { sliceSurfaceSegments } from '../surfaceGeometry'
import { geometryFromRoute } from './simulator'

/**
 * Builds compatibility geometry from the aggregate route data available in
 * zwift-data. Route elevation is cumulative elevation GAIN, not the elevation
 * difference between the start and finish. Treating it as endpoint elevation
 * makes every route climb continuously and is a major source of overly slow
 * dynamic predictions on rolling courses.
 *
 * For routes with no known named climbs (see `getRouteClimbs`), represent
 * each lap as a small number of rolling climb/descent sections. The synthetic
 * profile preserves the route's total distance and cumulative ascent while
 * avoiding the physically incorrect assumption that all climbing happens
 * continuously.
 */
function appendRollingLap(
  points: RouteGeometryPoint[],
  startDistanceM: number,
  startElevationM: number,
  lapDistanceM: number,
  lapElevationGainM: number
): { distanceM: number, elevationM: number } {
  const sectionCount = 4
  const sectionDistanceM = lapDistanceM / sectionCount
  const climbPerSectionM = lapElevationGainM / 2
  let distanceM = startDistanceM
  let elevationM = startElevationM

  // Two climbs and two descents, with zero net elevation change. This is a
  // deliberately conservative compatibility approximation for aggregate
  // route data; it is much closer to rolling Zwift courses than a continuous
  // average uphill grade.
  const elevationDeltas = [climbPerSectionM, -climbPerSectionM, climbPerSectionM, -climbPerSectionM]
  for (const deltaM of elevationDeltas) {
    distanceM += sectionDistanceM
    elevationM += deltaM
    points.push({ distanceM, elevationM })
  }

  return { distanceM, elevationM }
}

/**
 * Builds one lap's elevation profile from the route's real measured
 * `elevationProfile` (see `shared/utils/elevationGeometry.ts`) instead of
 * guessing - takes priority over both `appendKnownClimbsSegment` and
 * `appendRollingLap` wherever it's available, since it's real data for the
 * *whole* lap rather than an approximation anchored only around named
 * climbs. `profile` distances are rescaled to land exactly on `lapDistanceM`
 * (Strava's GPS-measured segment length can differ slightly from
 * `zwift-data`'s official route distance) so lap/lead-in chaining stays
 * consistent.
 */
function appendMeasuredLap(
  points: RouteGeometryPoint[],
  startDistanceM: number,
  startElevationM: number,
  lapDistanceM: number,
  profile: RouteElevationPoint[]
): { distanceM: number, elevationM: number } {
  const measuredTotalM = profile[profile.length - 1]?.distanceM ?? lapDistanceM
  const scale = measuredTotalM > 0 ? lapDistanceM / measuredTotalM : 1

  // `profile[0]` is always `{ distanceM: 0, elevationM: 0 }` (see
  // `computeElevationProfile`) - i.e. the current position, already the last
  // point pushed by whatever came before this lap. Skip it to avoid a
  // zero-length duplicate segment.
  for (const point of profile.slice(1)) {
    points.push({ distanceM: startDistanceM + point.distanceM * scale, elevationM: startElevationM + point.elevationM })
  }

  return { distanceM: startDistanceM + lapDistanceM, elevationM: startElevationM + (profile[profile.length - 1]?.elevationM ?? 0) }
}

/** A single straight-line segment at a uniform average grade. */
function appendStraightLine(
  points: RouteGeometryPoint[],
  startDistanceM: number,
  startElevationM: number,
  segmentDistanceM: number,
  elevationGainM: number
): { distanceM: number, elevationM: number } {
  const distanceM = startDistanceM + segmentDistanceM
  const elevationM = startElevationM + elevationGainM
  points.push({ distanceM, elevationM })
  return { distanceM, elevationM }
}

/**
 * Builds one segment's elevation profile (a lap, or the lead-in) using real
 * named-climb placement/gradient (`RouteClimb`, from `getRouteClimbs`)
 * instead of guessing. Known climbs are inserted at their exact position
 * with their real average gradient; the remaining "gap" distance
 * (before/between/after climbs, where no segment data exists) absorbs
 * whatever elevation gain isn't already accounted for by the known climbs,
 * plus enough descent to bring the segment back towards its starting
 * elevation - same closed-loop assumption `appendRollingLap` makes, now
 * anchored around real climb data wherever it's available.
 */
function appendKnownClimbsSegment(
  points: RouteGeometryPoint[],
  startDistanceM: number,
  startElevationM: number,
  lapDistanceM: number,
  lapElevationGainM: number,
  climbs: RouteClimb[]
): { distanceM: number, elevationM: number } {
  const climbBlocks = climbs
    .map(climb => ({
      fromM: Math.max(0, climb.fromKm * 1000),
      toM: Math.min(lapDistanceM, climb.toKm * 1000),
      elevationM: climb.elevationM
    }))
    .filter(block => block.toM > block.fromM)
    .sort((a, b) => a.fromM - b.fromM)

  const knownAscentM = climbBlocks.reduce((sum, block) => sum + Math.max(0, block.elevationM), 0)
  const remainingAscentM = Math.max(0, lapElevationGainM - knownAscentM)
  const totalDescentM = knownAscentM + remainingAscentM

  const gaps: { fromM: number, toM: number }[] = []
  let cursor = 0
  for (const block of climbBlocks) {
    if (block.fromM > cursor) gaps.push({ fromM: cursor, toM: block.fromM })
    cursor = Math.max(cursor, block.toM)
  }
  if (cursor < lapDistanceM) gaps.push({ fromM: cursor, toM: lapDistanceM })
  const totalGapDistanceM = gaps.reduce((sum, gap) => sum + (gap.toM - gap.fromM), 0)

  // A known climb can account for most/all of a route's official elevation
  // (or, for out-and-back KOMs whose descent isn't its own segment, even
  // exceed it), while leaving little unmapped distance nearby. Splitting the
  // remaining ascent/descent budget by raw distance share alone can then
  // demand an impossible grade to close the gap - e.g. cramming an entire
  // ~1000m descent into a 2.5km leftover stretch is a ~40% grade, physically
  // absurd and enough to make the simulator "freefall". Cap what any single
  // gap can absorb to a steep-but-plausible grade instead; any shortfall is
  // simply not modelled; the lap ends above/below its start elevation rather
  // than forcing a cliff. This also better matches reality for summit-finish
  // routes (e.g. Alpe du Zwift), which never return to their start elevation.
  const MAX_GAP_GRADE = 0.1

  let distanceM = startDistanceM
  let elevationM = startElevationM

  function emitGap(gap: { fromM: number, toM: number }) {
    const gapDistanceM = gap.toM - gap.fromM
    if (gapDistanceM <= 0) return
    const share = totalGapDistanceM > 0 ? gapDistanceM / totalGapDistanceM : 0
    const midDistanceM = gapDistanceM / 2
    const descentDistanceM = gapDistanceM - midDistanceM
    const ascentM = Math.min(remainingAscentM * share, MAX_GAP_GRADE * midDistanceM)
    const descentM = Math.min(totalDescentM * share, MAX_GAP_GRADE * descentDistanceM)

    distanceM += midDistanceM
    elevationM += ascentM
    points.push({ distanceM, elevationM })
    distanceM += descentDistanceM
    elevationM -= descentM
    points.push({ distanceM, elevationM })
  }

  cursor = 0
  for (const block of climbBlocks) {
    if (block.fromM > cursor) emitGap({ fromM: cursor, toM: block.fromM })
    distanceM += block.toM - block.fromM
    elevationM += block.elevationM
    points.push({ distanceM, elevationM })
    cursor = block.toM
  }
  if (cursor < lapDistanceM) emitGap({ fromM: cursor, toM: lapDistanceM })

  return { distanceM, elevationM }
}

/**
 * Real, position-tagged surface segments for one lap (`route.surface.segments`,
 * from `computeSurfaceProfile` via Strava GPS data), offset to `startDistanceM`
 * and clipped to `[startDistanceM, startDistanceM + lapDistanceM)`. Falls back
 * to a single segment covering the whole lap when no measured segments exist
 * (unmeasured routes) - the same "one surface for everything" approximation
 * `geometryFromRoute` already made, just scoped to one lap instead of the
 * whole ride.
 */
function lapSurfaceSegments(
  route: RouteWithMeta,
  startDistanceM: number,
  lapDistanceM: number,
  fallbackSurface: PhysicsSurface
): RouteSurfaceSegment[] {
  return sliceSurfaceSegments(route.surface.segments, 0, lapDistanceM / 1000, fallbackSurface, startDistanceM)
}

export function geometryForRouteLaps(route: RouteWithMeta, laps: number): RouteGeometry {
  const base = geometryFromRoute(route)
  const lapCount = Math.max(1, Math.floor(laps))
  const leadInDistanceM = (route.leadInDistance ?? 0) * 1000
  const leadInElevationM = route.leadInElevation ?? 0
  const lapDistanceM = route.distance * 1000
  const lapElevationM = route.elevation
  const fallbackSurface = base.surfaceSegments[0]?.surface ?? 'tarmac'
  // `RouteClimb.perLap` splits known climbs into the ones ridden once during
  // the (non-repeating) lead-in vs. the ones ridden once per lap - see
  // `getRouteClimbs`. Mixing them up would misplace/duplicate climbs, since
  // `fromKm`/`toKm` are relative to different start points for each.
  const leadInClimbs = route.terrain.climbs.filter(c => !c.perLap)
  const lapClimbs = route.terrain.climbs.filter(c => c.perLap)
  const points: RouteGeometryPoint[] = []
  const surfaceSegments: RouteSurfaceSegment[] = []
  let distanceM = 0
  let elevationM = 0

  points.push({ distanceM, elevationM })

  // Both measured arrays are lap-/lead-in-relative by the generation-time
  // normalization (issue #126): `elevationProfile` covers exactly one lap
  // starting `{0,0}`, and `leadInElevationProfile`/`leadInSegments` exist
  // only for the few routes whose source trace covered the lead-in too.
  // No runtime splitting - the old `splitMeasuredProfile` assumed every
  // profile was ride-relative, which carved the lap's own first `leadIn` km
  // off as "the lead-in" on ~300 lap-aligned routes and stretched the rest.
  const measuredLap = route.terrain.elevationProfile
  const measuredLeadIn = route.terrain.leadInElevationProfile

  if (leadInDistanceM > 0) {
    surfaceSegments.push(...sliceSurfaceSegments(route.surface.leadInSegments, 0, leadInDistanceM / 1000, fallbackSurface, distanceM))
    const result = measuredLeadIn && measuredLeadIn.length > 1
      ? appendMeasuredLap(points, distanceM, elevationM, leadInDistanceM, measuredLeadIn)
      : leadInClimbs.length > 0
        ? appendKnownClimbsSegment(points, distanceM, elevationM, leadInDistanceM, leadInElevationM, leadInClimbs)
        : appendStraightLine(points, distanceM, elevationM, leadInDistanceM, leadInElevationM)
    distanceM = result.distanceM
    elevationM = result.elevationM
  }

  for (let lap = 0; lap < lapCount; lap++) {
    surfaceSegments.push(...lapSurfaceSegments(route, distanceM, lapDistanceM, fallbackSurface))
    const result = measuredLap && measuredLap.length > 1
      ? appendMeasuredLap(points, distanceM, elevationM, lapDistanceM, measuredLap)
      : lapClimbs.length > 0
        ? appendKnownClimbsSegment(points, distanceM, elevationM, lapDistanceM, lapElevationM, lapClimbs)
        : appendRollingLap(points, distanceM, elevationM, lapDistanceM, lapElevationM)
    distanceM = result.distanceM
    elevationM = result.elevationM
  }

  return {
    routeSlug: route.slug,
    points,
    surfaceSegments,
    totalDistanceM: distanceM
  }
}

/**
 * Geometry for a single climb/sprint segment, ridden in isolation. With a
 * `measuredProfile` (the segment's slice of its host route's real elevation
 * profile - see `sliceElevationProfile`), the simulator rides the segment's
 * actual grade changes, exactly as `geometryForRouteLaps` does for a whole
 * route's measured lap: distances rescaled onto the official length,
 * measured elevations kept. Without one (membership segments, unmeasured
 * hosts, legacy mode) it falls back to the original 2-point line at the
 * segment's own average grade (the same per-block approximation
 * `appendKnownClimbsSegment` already makes for a climb within a whole
 * route). Both carry the segment's real position-tagged surface data. Used
 * by the segment ranking endpoint - see `prependWarmup` for how this is
 * turned into a realistic "already at speed" simulation.
 */
export function geometryForSegment(slug: string, lengthKm: number, elevationM: number, surfaceSegments: RouteSurfaceSegment[], measuredProfile?: RouteElevationPoint[]): RouteGeometry {
  const totalDistanceM = lengthKm * 1000
  if (measuredProfile && measuredProfile.length > 1) {
    const points: RouteGeometryPoint[] = [{ distanceM: 0, elevationM: 0 }]
    appendMeasuredLap(points, 0, 0, totalDistanceM, measuredProfile)
    return { routeSlug: slug, points, surfaceSegments, totalDistanceM }
  }
  return {
    routeSlug: slug,
    points: [
      { distanceM: 0, elevationM: 0 },
      { distanceM: totalDistanceM, elevationM }
    ],
    surfaceSegments,
    totalDistanceM
  }
}

/** Flat, tarmac "warmup" stretch used to bring a rider up to steady-state speed before a segment - see `prependWarmup`. */
export function geometryForWarmup(distanceM: number): RouteGeometry {
  return {
    routeSlug: 'warmup',
    points: [
      { distanceM: 0, elevationM: 0 },
      { distanceM, elevationM: 0 }
    ],
    surfaceSegments: [{ fromM: 0, toM: distanceM, surface: 'tarmac' }],
    totalDistanceM: distanceM
  }
}

/**
 * Prepends a flat warmup stretch to a segment's geometry, so simulating this
 * combined geometry reaches the segment already at whatever steady-state
 * speed the rider's power sustains - real Zwift/Strava segment leaderboards
 * are always entered already moving, never from a standing start, and a
 * standing-start simulation would badly distort rankings on short sprints
 * (overrewarding low-mass/high-acceleration combos for reasons that have
 * nothing to do with how these are actually contested). The segment
 * endpoint runs `simulateRoute` on this combined geometry AND on
 * `geometryForWarmup(warmupDistanceM)` alone, then subtracts the warmup-only
 * elapsed time to isolate the segment's own time - since both runs share
 * identical starting conditions and warmup geometry, their elapsed time at
 * the warmup/segment boundary is identical, so the subtraction is exact, no
 * `simulateRoute` changes needed.
 */
export function prependWarmup(segmentGeometry: RouteGeometry, warmupDistanceM: number): RouteGeometry {
  const warmup = geometryForWarmup(warmupDistanceM)
  return {
    routeSlug: segmentGeometry.routeSlug,
    points: [
      ...warmup.points,
      ...segmentGeometry.points.slice(1).map(point => ({ ...point, distanceM: point.distanceM + warmupDistanceM }))
    ],
    surfaceSegments: [
      ...warmup.surfaceSegments,
      ...segmentGeometry.surfaceSegments.map(segment => ({ ...segment, fromM: segment.fromM + warmupDistanceM, toM: segment.toM + warmupDistanceM }))
    ],
    totalDistanceM: warmupDistanceM + segmentGeometry.totalDistanceM
  }
}
