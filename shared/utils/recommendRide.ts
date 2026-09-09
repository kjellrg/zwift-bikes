import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from '../types/catalog'
import type { PhysicsRider, RouteGeometry } from '../types/physics'
import type { PowerSegmentW, simulateRoute } from './physics'
import { geometryForRouteLaps, geometryForSegment, geometryForWarmup, prependWarmup } from './physics/routeGeometry'
import { clampLaps } from './routeLaps'
import { sliceSurfaceSegments } from './surfaceGeometry'

export type TimingMetaValue = string | number | boolean | undefined

/** Everything one combo's timing needs beyond the ride's own geometry. */
export interface SimulateComboOptions {
    frame: ClassifiedBikeFrame
    wheelset?: Wheelset
    /**
         * The TTT pacing plan, in the RIDE's own coordinates - a ride that
         * simulates on shifted geometry has to shift these to match.
         */
    powerSegmentsW?: PowerSegmentW[]
    /**
         * The draft power scaling. Absent for the "what would this be solo?"
         * disclosures, which are the same ride with nothing but the draft removed.
         */
    powerScaleAtSpeed?: (speedMps: number) => number
}

export interface RidePhysics {
    /**
         * Times one combo on this ride. Present exactly when `prepare` was given a
         * rider, i.e. when this request simulates at all.
         */
    simulateSec?: (options: SimulateComboOptions) => number
}

/** The ride being ranked: a whole route, or one segment. */
export interface RecommendRide {
    /** What `rankCombos` / `estimateFinishTimeSec` / `estimateSurfaceTimePenaltySec` rank against. */
    route: RouteWithMeta
    /** Clamped laps for a route, 1 for a segment. */
    laps: number
    /** Drop TT frames from the pool entirely; always false for a segment. */
    excludeTT: boolean
    /**
         * Ride-specific fields for the timing log line, spread in FIRST so its key
         * order is unchanged (route: `route`, `distanceKm`, `laps`; segment:
         * `segment`, `route`, `distanceKm`).
         */
    timingMeta: Record<string, TimingMetaValue>
    planGeometry: () => RouteGeometry
    /**
         * `rider` is present exactly when this request simulates - a complete
         * rider profile AND a physics mode that runs the simulator.
         * `simulate` is the pipeline's counted `simulateRoute`: every integration
         * a ride runs has to go through it, or the `sims` figure in the timing log
         * stops counting the work.
         */
    prepare: (simulate: typeof simulateRoute, rider?: PhysicsRider) => RidePhysics
}

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
// setting. That's deliberate: warm-up-only time is subtracted back out, so
// its sole effect is entering the segment at steady-state speed for that
// power (a flying sprint), applied identically to every combo.
export const WARMUP_DISTANCE_M = 2000

export function rideForSegment(segmentRoute: RouteWithMeta, warmupDistanceM = WARMUP_DISTANCE_M): RecommendRide {
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
        excludeTT: false,
        timingMeta: { segment: segmentRoute.slug, route: segmentRoute.slug, distanceKm: Math.round(segmentRoute.distance * 10) / 10 },
        planGeometry,
        prepare: (simulate, rider) => {
            if (!rider) return {}
            const warmedGeometry = prependWarmup(planGeometry(), warmupDistanceM)
            const warmupOnlyGeometry = geometryForWarmup(warmupDistanceM)
            return {
                // TWO integrations per candidate - the warmed run minus the warm-up
                // alone - so this endpoint's `sims` count runs roughly double the
                // route endpoint's for the same-sized pool. Both must share the same
                // time step for the subtraction to cancel cleanly; they use the
                // simulator's default (see `DEFAULT_DT_SEC`).
                //
                // The pacing plan arrives in the segment's own coordinates and is
                // offset into the warmed ones here. The warm-up-only run gets no
                // climb overrides - a flat warm-up can never contain a climb block -
                // but it DOES get the same draft scaling, so both runs cross the
                // warm-up under identical conditions and the subtraction still
                // cancels. (It is very slightly inexact for a reason that predates
                // draft mode: the steady-state early exit fires in the warm-up-only
                // run but not in the warmed one. See the note in the TTT PR.)
                simulateSec: ({ frame, wheelset, powerSegmentsW, powerScaleAtSpeed }) =>
                    simulate({
                        rider,
                        frame,
                        wheelset,
                        geometry: warmedGeometry,
                        powerSegmentsW: powerSegmentsW?.map(segment => ({ ...segment, fromM: segment.fromM + warmupDistanceM, toM: segment.toM + warmupDistanceM })),
                        powerScaleAtSpeed
                    }).elapsedSec
                    - simulate({ rider, frame, wheelset, geometry: warmupOnlyGeometry, powerScaleAtSpeed }).elapsedSec
            }
        }
    }
}
