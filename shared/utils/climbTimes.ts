import type { PhysicsSimulationResult } from '../types/physics'
import type { SegmentOccurrence } from './routeOccurrences'

/**
 * Climb time (see `CONTEXT.md`): how long a setup takes over one pass of a
 * named climb, cut from the simulation that times its whole Ride. The
 * simulator already records the elapsed time at any distance it is handed
 * (`boundariesM` -> `boundaryCrossings`) without changing a single step of
 * the integration, so passing each pass's start and end is enough - nothing
 * is simulated twice, and a Climb time can never disagree with the finish
 * time beside it.
 */

/** Every pass's start and end, in metres, ascending and without repeats - the simulator's `boundariesM`. */
export function climbBoundariesM(climbs: readonly SegmentOccurrence[]): number[] {
  const boundaries = new Set<number>()
  for (const climb of climbs) {
    boundaries.add(climb.rideFromKm * 1000)
    boundaries.add(climb.rideToKm * 1000)
  }
  return [...boundaries].sort((a, b) => a - b)
}

/**
 * Each pass's Climb time, in the order of `climbs`, from a simulation run
 * with `climbBoundariesM(climbs)`. A pass that ends on the line may be
 * missing its end crossing - the last step lands on the finish only to
 * floating-point precision - and the finish time stands in for it.
 */
export function climbTimesSec(climbs: readonly SegmentOccurrence[], result: PhysicsSimulationResult): number[] {
  const elapsedAt = new Map((result.boundaryCrossings ?? []).map(crossing => [crossing.distanceM, crossing.elapsedSec]))
  return climbs.map(climb =>
    (elapsedAt.get(climb.rideToKm * 1000) ?? result.elapsedSec) - (elapsedAt.get(climb.rideFromKm * 1000) ?? 0))
}
