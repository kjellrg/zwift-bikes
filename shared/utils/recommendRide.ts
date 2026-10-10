import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from '../types/catalog'
import type { PhysicsRider, RouteGeometry } from '../types/physics'
import type { RecommendRide } from '../types/recommendRide'
import { courseCoverage } from './courseCoverage'
import { resolveDraft, type Draft } from './physics/draft'
import { geometryForRouteLaps, geometryForSegment, geometryForWarmup, type RouteLapsGeometry } from './physics/routeGeometry'
import { computeRouteSurfaceSpeedProfile, type RouteSurfaceSpeedProfile, type SpeedProfileEntry, type SpeedProfileRider, type SpeedProfileSetup } from './physics/routeSurfaceSpeedProfile'
import { simulateRoute } from './physics/simulator'
import { clampLaps, computeRouteTotals } from './routeLaps'
import { climbBoundariesM, climbTimesSec } from './climbTimes'
import { expandClimbsForLaps, expandSprintsForLaps } from './routeOccurrences'
import { courseProfile, type CourseProfile, type CourseProfileOptions } from './silhouette'
import { sliceSurfaceSegments } from './surfaceGeometry'

/**
 * The resolved Ride (`RecommendRide`, see `CONTEXT.md`): the one place a
 * course's geometry is built. `geometryForRouteLaps` and `geometryForSegment`
 * are called from here and nowhere else in the app, so the ranking, the
 * Course hero, the speed chart and the TTT plan all read one geometry, one
 * clamped lap count and one coverage rule.
 *
 * IMPORTANT: the client imports this module (the ranking pages resolve their
 * Rides in the browser), so nothing reachable from it may import the
 * zwift-data catalog or the generated surface table - see
 * `scripts/check-client-bundle.mjs`.
 */

/** A Ride's drawn profiles, memoised per sample count. */
function memoBySamples(build: (options: CourseProfileOptions) => CourseProfile | undefined) {
  const memo = new Map<number | undefined, CourseProfile | undefined>()
  return (options: CourseProfileOptions = {}) => {
    if (!memo.has(options.samples)) memo.set(options.samples, build(options))
    return memo.get(options.samples)
  }
}

const NO_WHEELS = {}

/**
 * A Ride's speed profiles, memoised per setup (the frame and wheel objects
 * the ranking handed out), rider and draft. A results refresh hands out new
 * objects and so new entries; the old ones go with them.
 */
function speedProfileMemo(compute: (setup: SpeedProfileSetup, rider: SpeedProfileRider, draft: Draft, simulate: typeof simulateRoute) => RouteSurfaceSpeedProfile | undefined) {
  const byFrame = new WeakMap<ClassifiedBikeFrame, WeakMap<Wheelset | typeof NO_WHEELS, Map<string, RouteSurfaceSpeedProfile | undefined>>>()
  return (setup: SpeedProfileSetup, rider: SpeedProfileRider, draft: Draft, simulate: typeof simulateRoute = simulateRoute) => {
    let byWheels = byFrame.get(setup.frame)
    if (!byWheels) byFrame.set(setup.frame, byWheels = new WeakMap())
    const wheelsKey = setup.wheelset ?? NO_WHEELS
    let byRest = byWheels.get(wheelsKey)
    if (!byRest) byWheels.set(wheelsKey, byRest = new Map())
    const key = JSON.stringify([rider.weightKg, rider.heightCm, rider.powerW, draft])
    if (!byRest.has(key)) byRest.set(key, compute(setup, { weightKg: rider.weightKg, heightCm: rider.heightCm, powerW: rider.powerW }, draft, simulate))
    return byRest.get(key)
  }
}

/**
 * The first pass of a route's lap with its lead-in, cut out of the Ride's
 * own geometry at the second lap's start rather than built again, so it is
 * the same points the ranking rides. The whole geometry on one lap.
 */
export function firstLapOfRide(geometry: RouteLapsGeometry): RouteGeometry {
  const endM = geometry.lapStartsM[1]
  if (endM === undefined) {
    const { routeSlug, points, surfaceSegments, totalDistanceM } = geometry
    return { routeSlug, points, surfaceSegments, totalDistanceM }
  }
  // The lap's last point is the next lap's start, chained by the same
  // arithmetic, so it sits on `endM` to within rounding; the next lap's
  // first point is a measured step beyond it.
  const points = geometry.points.filter(point => point.distanceM <= endM + 1e-6)
  return {
    routeSlug: geometry.routeSlug,
    points,
    surfaceSegments: geometry.surfaceSegments.filter(segment => segment.fromM < endM),
    totalDistanceM: endM
  }
}

/**
 * What a profile is drawn from when a listing has only a route's summary
 * (`RouteSummary`): the terrain and surfaces, with no lead-in and no `lap`.
 */
export type CourseProfileRoute = Pick<RouteWithMeta, 'slug' | 'distance' | 'elevation' | 'terrain' | 'surface'>
  & Partial<Pick<RouteWithMeta, 'leadInDistance' | 'leadInElevation' | 'lap'>>

/**
 * A listing's Ride: a route summary resolved as one lap - the summary carries
 * no lead-in, so its Silhouette is the lap alone, which is what a listing
 * describes, and a climb or sprint ridden only in the lead-in has no place
 * on it. Every field the geometry builder reads is on a summary; the lead-in
 * ones it treats as absent when they are.
 */
export function rideForListedRoute(route: CourseProfileRoute): RecommendRide {
  return rideForRoute(route as RouteWithMeta, 1)
}

export function rideForRoute(route: RouteWithMeta, requestedLaps?: number, excludeTT = false): RecommendRide {
  const laps = clampLaps(route, requestedLaps)
  let geometry: RouteLapsGeometry | undefined
  const lapsGeometry = () => geometry ??= geometryForRouteLaps(route, laps)
  const planGeometry = (): RouteGeometry => lapsGeometry()
  const leadInM = (route.leadInDistance ?? 0) * 1000
  // A lead-in placement is on the ride only where there is a lead-in to ride
  // it in - always, on a whole route; never, on a listing's summary.
  const onRide = (occurrence: { perLap: boolean }) => occurrence.perLap || leadInM > 0
  // The same passes the Course hero draws, so a Climb trade names a band the
  // rider can see.
  const climbs = expandClimbsForLaps(route, laps).filter(onRide)
  const sprints = expandSprintsForLaps(route, laps).filter(onRide)
  const coverage = courseCoverage(route)
  const boundariesM = climbBoundariesM(climbs)
  return {
    route,
    laps,
    excludeTT,
    climbs,
    sprints,
    totals: computeRouteTotals(route, laps),
    coverage,
    timingMeta: { route: route.slug, distanceKm: Math.round(route.distance * laps * 10) / 10, laps },
    planGeometry,
    // An unmeasured lead-in is ridden, so it is drawn, from the builder's
    // approximation (a straight line, or its known climbs), and
    // `approximatedUntil` marks it so every renderer dashes it. The surface
    // strip is drawn only where the lap's surfaces were measured, never from
    // a mix laid out in share order.
    profile: memoBySamples(options => coverage.measuredLap
      ? courseProfile({
          points: lapsGeometry().points,
          surfaceSegments: coverage.positionedSurfaces ? lapsGeometry().surfaceSegments : undefined,
          climbs,
          sprints,
          approximatedUntilM: leadInM > 0 && !coverage.measuredLeadIn ? leadInM : undefined,
          lapStartsM: lapsGeometry().lapStartsM.slice(1)
        }, options)
      : undefined),
    // Per lap, with the lead-in: the scope line says so, rather than the
    // chart repeating the same lap `laps` times over. The draft, and with it
    // any TTT pacing plan, is the ranking's - resolved on the whole Ride.
    speedProfile: speedProfileMemo((setup, rider, draft, simulate) => {
      if (!coverage.measuredLap || !coverage.positionedSurfaces) return undefined
      const rideDraft = resolveDraft(draft, planGeometry(), rider)
      return computeRouteSurfaceSpeedProfile(firstLapOfRide(lapsGeometry()), setup, rider, rideDraft, {}, simulate)
    }),
    prepare: (simulate, rider) => {
      if (!rider) return {}
      const geometry = planGeometry()
      return {
        timeCombo: ({ frame, wheelset, draft }) => {
          const result = simulate({ rider, frame, wheelset, geometry, boundariesM, powerSegmentsW: draft.plan?.powerSegmentsW, powerScaleAtSpeed: draft.powerScaleAtSpeed })
          return { finishSec: result.elapsedSec, climbSec: climbTimesSec(climbs, result) }
        }
      }
    }
  }
}

// Flat lead-up distance simulated before the timed segment itself, long
// enough for a rider's speed to converge close to steady-state for their
// power before entering the segment - see `prependWarmup`'s doc comment for
// why a standing-start simulation would badly distort segment rankings.
// The warm-up is ridden at the request's own power - even a 1500 W sprint
// setting. That's deliberate: only the exit speed enters the timed run, so
// its sole effect is entering the segment at steady-state speed for that
// power (a flying sprint), applied identically to every combo.
export const WARMUP_DISTANCE_M = 2000

const WARMUP_STEADY_STATE_TOLERANCE_MPS2 = 0.000001

/**
 * The speed a segment is entered at: one counted integration of the flat
 * warm-up under the draft's power scale, at tight convergence so the
 * steady-state shortcut never hands over a still-accelerating speed (issue
 * #199; docs/shared-ride-verification.md). Drafted but never paced: the plan
 * is in the timed run's coordinates. The timed run and the speed chart both
 * enter through here, so the chart is the timed estimate.
 */
function warmupExitSpeedMps(
  simulate: typeof simulateRoute,
  warmup: RouteGeometry,
  rider: PhysicsRider,
  setup: SpeedProfileSetup,
  powerScaleAtSpeed: ((speedMps: number) => number) | undefined
): number {
  return simulate({
    rider,
    frame: setup.frame,
    wheelset: setup.wheelset,
    geometry: warmup,
    powerScaleAtSpeed,
    steadyStateToleranceMps2: WARMUP_STEADY_STATE_TOLERANCE_MPS2
  }).finalSpeedMps
}

/**
 * `excludeTT` is the segment's own copy of the route builder's, and for the
 * same reason: a segment can be ridden under a race format (a scoring sprint
 * inside a points race, or a page told one through `?rules=`), and the format
 * bars TT frames from the segment exactly as it bars them from the race - see
 * `ttBikesAllowed` in `./events.ts`. It was hardcoded `false` here while only
 * the race page could express a format, which silently ranked bikes a rider
 * could not start on (issue #224).
 */
export function rideForSegment(segmentRoute: RouteWithMeta, excludeTT = false, warmupDistanceM = WARMUP_DISTANCE_M): RecommendRide {
  const surfaceSegments = sliceSurfaceSegments(segmentRoute.surface.segments, 0, segmentRoute.distance, 'tarmac')
  let geometry: RouteGeometry | undefined
  const planGeometry = () => geometry ??= geometryForSegment(
    segmentRoute.slug,
    segmentRoute.distance,
    segmentRoute.elevation,
    surfaceSegments,
    segmentRoute.terrain.elevationProfile
  )
  let warmup: RouteGeometry | undefined
  const warmupGeometry = () => warmup ??= geometryForWarmup(warmupDistanceM)
  const coverage = courseCoverage(segmentRoute)
  return {
    route: segmentRoute,
    laps: 1,
    excludeTT,
    climbs: [],
    sprints: [],
    totals: computeRouteTotals(segmentRoute, 1),
    coverage,
    timingMeta: { segment: segmentRoute.slug, route: segmentRoute.slug, distanceKm: Math.round(segmentRoute.distance * 10) / 10 },
    planGeometry,
    // The segment's own stretch of road, no lead-in, no laps, and nothing
    // named on it: a segment is one climb or sprint already.
    profile: memoBySamples(options => coverage.measuredLap
      ? courseProfile({
          points: planGeometry().points,
          surfaceSegments: coverage.positionedSurfaces ? planGeometry().surfaceSegments : undefined
        }, options)
      : undefined),
    speedProfile: speedProfileMemo((setup, rider, draft, simulate) => {
      if (!coverage.measuredLap || !coverage.positionedSurfaces) return undefined
      const geometry = planGeometry()
      const rideDraft = resolveDraft(draft, geometry, rider)
      const entry: SpeedProfileEntry = {
        initialSpeedMps: warmupExitSpeedMps(simulate, warmupGeometry(), rider, setup, rideDraft.powerScaleAtSpeed),
        soloInitialSpeedMps: draft.mode === 'solo' ? undefined : warmupExitSpeedMps(simulate, warmupGeometry(), rider, setup, rideDraft.solo.powerScaleAtSpeed)
      }
      return computeRouteSurfaceSpeedProfile(geometry, setup, rider, rideDraft, entry, simulate)
    }),
    prepare: (simulate, rider) => {
      if (!rider) return {}
      const geometry = planGeometry()
      return {
        // Two counted integrations preserve a flying start without subtracting
        // independently approximated times. Only the warm-up's exit speed is
        // transferred, so the timed run and plan use the same coordinates -
        // which is why the warm-up is drafted (its exit speed is the drafted
        // group's) but never paced: the plan is in the timed run's coordinates.
        timeCombo: ({ frame, wheelset, draft }) => {
          const timed = simulate({
            rider,
            frame,
            wheelset,
            geometry,
            initialSpeedMps: warmupExitSpeedMps(simulate, warmupGeometry(), rider, { frame, wheelset }, draft.powerScaleAtSpeed),
            powerSegmentsW: draft.plan?.powerSegmentsW,
            powerScaleAtSpeed: draft.powerScaleAtSpeed
          })
          return { finishSec: timed.elapsedSec, climbSec: [] }
        }
      }
    }
  }
}
