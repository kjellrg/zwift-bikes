import type { RouteWithMeta } from '../types/catalog'
import type { RouteGeometry } from '../types/physics'
import type { RecommendRide } from '../types/recommendRide'
import { geometryForRouteLaps, geometryForSegment, geometryForWarmup } from './physics/routeGeometry'
import { clampLaps } from './routeLaps'
import { sliceSurfaceSegments } from './surfaceGeometry'

export function rideForRoute(route: RouteWithMeta, requestedLaps?: number, excludeTT = false): RecommendRide {
  const laps = clampLaps(route, requestedLaps)
  let geometry: RouteGeometry | undefined
  const planGeometry = () => geometry ??= geometryForRouteLaps(route, laps)
  return {
    route,
    laps,
    excludeTT,
    timingMeta: { route: route.slug, distanceKm: Math.round(route.distance * laps * 10) / 10, laps },
    planGeometry,
    prepare: (simulate, rider) => {
      if (!rider) return {}
      const geometry = planGeometry()
      return {
        simulateSec: ({ frame, wheelset, powerSegmentsW, powerScaleAtSpeed }) =>
          simulate({ rider, frame, wheelset, geometry, powerSegmentsW, powerScaleAtSpeed }).elapsedSec
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
  return {
    route: segmentRoute,
    laps: 1,
    excludeTT,
    timingMeta: { segment: segmentRoute.slug, route: segmentRoute.slug, distanceKm: Math.round(segmentRoute.distance * 10) / 10 },
    planGeometry,
    prepare: (simulate, rider) => {
      if (!rider) return {}
      const geometry = planGeometry()
      const warmupOnlyGeometry = geometryForWarmup(warmupDistanceM)
      return {
        // Two counted integrations preserve a flying start without subtracting
        // independently approximated times. Only the warm-up's exit speed is
        // transferred, so the timed run and plan use the same coordinates.
        // Tight convergence prevents the warm-up shortcut from handing over
        // a still-accelerating speed (issue #199; docs/shared-ride-verification.md).
        simulateSec: ({ frame, wheelset, powerSegmentsW, powerScaleAtSpeed }) => {
          const warmup = simulate({
            rider,
            frame,
            wheelset,
            geometry: warmupOnlyGeometry,
            powerScaleAtSpeed,
            steadyStateToleranceMps2: WARMUP_STEADY_STATE_TOLERANCE_MPS2
          })
          return simulate({
            rider,
            frame,
            wheelset,
            geometry,
            initialSpeedMps: warmup.finalSpeedMps,
            powerSegmentsW,
            powerScaleAtSpeed
          }).elapsedSec
        }
      }
    }
  }
}
