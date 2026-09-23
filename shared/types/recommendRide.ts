import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from './catalog'
import type { PhysicsRider, RouteGeometry } from './physics'
import type { RideDraft, simulateRoute } from '../utils/physics'
import type { RouteClimbOccurrence } from '../utils/routeOccurrences'

export type TimingMetaValue = string | number | boolean | undefined

/** Everything one combo's timing needs beyond the ride's own geometry. */
export interface SimulateComboOptions {
  frame: ClassifiedBikeFrame
  wheelset?: Wheelset
  /**
     * The Draft this timing is ridden under, resolved on this ride's own
     * geometry (`resolveDraft(_, ride.planGeometry(), _)`) - a ride that
     * simulates on shifted geometry has to shift its plan to match. Always
     * present: the "what would this be solo?" disclosures pass `draft.solo`,
     * never a draft with a field left out.
     */
  draft: RideDraft
}

/** What one timing of a combo on a ride measures. */
export interface ComboTiming {
  finishSec: number
  /**
     * The Climb time of each of the ride's `climbs` (see `CONTEXT.md`), in the
     * same order, cut from the simulation that gave `finishSec`. Empty on a
     * ride with no named climbs.
     */
  climbSec: number[]
}

export interface RidePhysics {
  /**
     * Times one combo on this ride. Present exactly when `prepare` was given a
     * rider, i.e. when this request simulates at all.
     */
  time?: (options: SimulateComboOptions) => ComboTiming
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
     * Every pass of a named climb on the ride, in ride order - the passes each
     * `ComboTiming.climbSec` is timed over. Empty for a segment: a segment is
     * one climb or sprint already, and its finish time is its Climb time.
     */
  climbs: RouteClimbOccurrence[]
  /**
     * Ride-specific fields for the timing log line, spread in FIRST so its key
     * order is unchanged (route: `route`, `distanceKm`, `laps`; segment:
     * `segment`, `route`, `distanceKm`).
     */
  timingMeta: Record<string, TimingMetaValue>
  /** Lazy and memoised in ride coordinates, shared by plan detection and timing in every physics mode. */
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
