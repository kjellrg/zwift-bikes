import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from './catalog'
import type { PhysicsRider, RouteGeometry } from './physics'
import type { CourseCoverage } from '../utils/courseCoverage'
import type { Draft, RideDraft, simulateRoute } from '../utils/physics'
import type { RouteSurfaceSpeedProfile, SpeedProfileRider, SpeedProfileSetup } from '../utils/physics/routeSurfaceSpeedProfile'
import type { RouteClimbOccurrence, RouteSprintOccurrence } from '../utils/routeOccurrences'
import type { RouteTotals } from '../utils/routeLaps'
import type { CourseProfile, CourseProfileOptions } from '../utils/silhouette'

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
  timeCombo?: (options: SimulateComboOptions) => ComboTiming
}

/**
 * The ride being ranked, resolved: a whole route, or one segment. The one
 * place a course's geometry is known (see Ride and Ride-only in
 * `CONTEXT.md`): the ranking times on `planGeometry`, and the Course hero,
 * the speed chart, the TTT plan and every "is this course measured?" read
 * this object rather than building geometry of their own - so the picture,
 * the markers, the chart and the finish time describe one ride.
 */
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
  /** Every pass of a named sprint on the ride, in ride order - the marks the Course hero draws and the course tabs list. Empty for a segment. */
  sprints: RouteSprintOccurrence[]
  /** Distance, elevation and lead-in for `laps` - the lead-in once. */
  totals: RouteTotals
  /** What the course's geometry is built from - the one "is this course measured?" rule, `courseCoverage`. */
  coverage: CourseCoverage
  /**
     * Ride-specific fields for the timing log line, spread in FIRST so its key
     * order is unchanged (route: `route`, `distanceKm`, `laps`; segment:
     * `segment`, `route`, `distanceKm`).
     */
  timingMeta: Record<string, TimingMetaValue>
  /** Lazy and memoised in ride coordinates, shared by plan detection and timing in every physics mode. */
  planGeometry: () => RouteGeometry
  /**
   * The drawn profile of `planGeometry` (lazy, memoised per `samples`): its
   * points, its surfaces where their positions are measured, the climbs and
   * sprints as bands and marks, where each lap starts and the approximated
   * lead-in. Undefined when the lap has no measured profile: the geometry
   * is then the model's own approximation, and a drawing of it would be a
   * shape nobody has ridden.
   */
  profile: (options?: CourseProfileOptions) => CourseProfile | undefined
  /**
   * One setup's speed profile on this ride under `draft`, resolved on the
   * full `planGeometry` as the ranking resolves it: on a route one pass of
   * the lap with the lead-in, cut out of `planGeometry`; on a segment the
   * segment whole, entered at its warm-up's exit speed exactly as
   * `timeCombo` enters it. Memoised per setup, rider and draft; computed
   * only when asked. Undefined without a measured lap and positioned
   * surfaces. `simulate` is for a test to count the integrations.
   */
  speedProfile: (setup: SpeedProfileSetup, rider: SpeedProfileRider, draft: Draft, simulate?: typeof simulateRoute) => RouteSurfaceSpeedProfile | undefined
  /**
     * `rider` is present exactly when this request simulates - a complete
     * rider profile AND a physics mode that runs the simulator.
     * `simulate` is the pipeline's counted `simulateRoute`: every integration
     * a ride runs has to go through it, or the `sims` figure in the timing log
     * stops counting the work.
     */
  prepare: (simulate: typeof simulateRoute, rider?: PhysicsRider) => RidePhysics
}
