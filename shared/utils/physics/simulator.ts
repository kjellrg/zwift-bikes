import type { RouteWithMeta, Wheelset } from '../../types/catalog'
import type { PhysicsEquipment, PhysicsRider, PhysicsSimulationResult, PhysicsState, PhysicsSurface, RouteGeometry, RouteSurfaceSegment } from '../../types/physics'
import { calculateForces } from './forces'
import { equipmentPhysics, riderScaledCdaM2 } from './equipment'

export interface SimulateRouteOptions {
  rider: PhysicsRider
  frame: PhysicsEquipment['frame']
  wheelset?: Wheelset
  geometry: RouteGeometry
  dtSec?: number
  initialSpeedMps?: number
  /** Distances (m, ascending) to record cumulative elapsed time at as the simulation crosses them - see `boundaryCrossings` on the result. */
  boundariesM?: number[]
  /**
   * Optional power overrides by position (m, ascending, non-overlapping):
   * inside `[fromM, toM)` the rider produces `powerW` instead of
   * `rider.powerW`; outside every segment the base power applies. Used by the
   * TTT draft mode to ride long climbs at a team climb power (see
   * `physics/draft.ts`) and for the solo-equivalent comparison. Absent means
   * exactly today's behavior.
   */
  powerSegmentsW?: { fromM: number, toM: number, powerW: number }[]
  /**
   * Optional multiplier on the rider's power as a function of the CURRENT
   * speed, applied on top of `powerSegmentsW`. Used by the TTT draft mode:
   * a paceline whose riders each average `rider.powerW` drives itself at
   * `powerW / averagePowerFactor(speed)`, and that factor depends on how
   * fast the group is actually moving (see `tttPowerScaleAtSpeed`), so the
   * benefit fades on climbs and grows on descents with no per-grade
   * bookkeeping here. Evaluated at both midpoint-integration velocities.
   * Absent means exactly today's behavior.
   */
  powerScaleAtSpeed?: (speedMps: number) => number
}

/** Grade at `distanceM`, from the elevation profile (`geometry.points`). */
function gradeSegmentAt(geometry: RouteGeometry, distanceM: number) {
  const points = geometry.points
  if (points.length < 2) return undefined
  let low = 0
  let high = points.length - 1
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid]!.distanceM <= distanceM) low = mid
    else high = mid
  }
  const a = points[low]!
  const b = points[Math.min(low + 1, points.length - 1)]!
  const distanceDelta = b.distanceM - a.distanceM
  const elevationDelta = b.elevationM - a.elevationM
  return { grade: distanceDelta > 0 ? elevationDelta / distanceDelta : 0, endDistanceM: b.distanceM }
}

/**
 * Surface at `distanceM`, from `geometry.surfaceSegments` - looked up
 * independently of the elevation profile above, since real surface
 * transitions don't happen at the same positions as grade changes (see
 * `routeGeometry.ts`).
 */
function surfaceAt(segments: RouteSurfaceSegment[], distanceM: number): PhysicsSurface {
  if (segments.length === 0) return 'tarmac'
  let low = 0
  let high = segments.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (segments[mid]!.toM <= distanceM) low = mid + 1
    else high = mid
  }
  return segments[low]!.surface
}

/**
 * Records a crossing for every boundary in `boundariesM` that falls within
 * `(fromDistanceM, toDistanceM]`, linearly interpolating its elapsed time
 * between the two known (distance, time) points - a step can advance several
 * metres, so a boundary rarely lands exactly on a step edge. `boundaryIndex`
 * is a pointer into the ascending `boundariesM` array, threaded through calls
 * so repeated crossings (main loop + the steady-state early-exit remainder)
 * never re-check boundaries already passed.
 */
function crossBoundaries(
  boundariesM: number[] | undefined,
  boundaryIndex: number,
  crossings: { distanceM: number, elapsedSec: number }[],
  fromDistanceM: number,
  fromElapsedSec: number,
  toDistanceM: number,
  toElapsedSec: number
): number {
  if (!boundariesM) return boundaryIndex
  const span = toDistanceM - fromDistanceM
  while (boundaryIndex < boundariesM.length && boundariesM[boundaryIndex]! <= toDistanceM) {
    const boundaryM = boundariesM[boundaryIndex]!
    const fraction = span > 0 ? (boundaryM - fromDistanceM) / span : 0
    crossings.push({ distanceM: boundaryM, elapsedSec: fromElapsedSec + fraction * (toElapsedSec - fromElapsedSec) })
    boundaryIndex++
  }
  return boundaryIndex
}

/**
 * Integration step, in seconds. Benchmarked against the recommend endpoint
 * (9-combo page) rather than the simulator alone: with the midpoint step
 * below, 0.1s leaves ~0.2s of absolute error and ~0.05s of error in the gaps
 * BETWEEN combos - the number the results list actually shows - for ~250ms
 * of page simulation on the longest route (Gran Fondo, 97.5km). Halving it
 * again roughly doubles that cost for far less than half the residual error,
 * which is dominated by how finely the elevation profile is sampled rather
 * than by the time step.
 */
const DEFAULT_DT_SEC = 0.1

/**
 * Above this total distance the default step grows linearly with distance
 * (capped at `MAX_DT_SEC`), holding the step COUNT roughly constant instead
 * of letting a 174km route cost 16x an 11km one. Workers production CPU
 * made this matter: the PRL Full's ~60-sim page ran 2.5-10.7s of `simulate`
 * phase there (docs/observability.md), and the step count is that cost.
 *
 * Why this doesn't degrade results (measured 2026-08-21 against a dt=0.02
 * reference, 24 physics-distinct combos, routes 64-174km - the sweep lives
 * in the PR discussion): the growing step's error stays inside the noise
 * the 0.1 baseline already has on long routes. At the cap (PRL Full, 174km,
 * 5.6h): absolute error 17.6s (0.087%, vs the baseline's own 5.7s),
 * adjacent-combo gap error 5.95s (vs 2.54s), and NO ordering changes; at
 * intermediate lengths ordering changes are confined to combos within
 * ~0.6s of each other on multi-hour rides - pairs the 0.1 baseline
 * itself also flips (its gran-fondo run flips a 0.608s pair). Every route
 * at or under the knee is bit-identical to before. Cost on the PRL Full:
 * 38 -> 15ms per simulation locally, the same factor on the Worker.
 */
const ADAPTIVE_DT_KNEE_DISTANCE_M = 60_000
const MAX_DT_SEC = 0.3

function defaultDtSec(totalDistanceM: number): number {
  return Math.min(MAX_DT_SEC, Math.max(DEFAULT_DT_SEC, DEFAULT_DT_SEC * totalDistanceM / ADAPTIVE_DT_KNEE_DISTANCE_M))
}

export function simulateRoute(options: SimulateRouteOptions): PhysicsSimulationResult {
  const dt = options.dtSec ?? defaultDtSec(options.geometry.totalDistanceM)
  if (dt <= 0) throw new Error('dtSec must be positive')
  if (options.geometry.points.length < 2) throw new Error('Route geometry requires at least two points')

  const equipment = equipmentPhysics(options.frame, options.wheelset)
  const physicsEquipment = { ...equipment, cdaM2: riderScaledCdaM2(equipment.cdaM2, options.rider.heightCm ?? 183, options.rider.weightKg) }
  const crrClass = options.wheelset?.crrClass ?? 'road'
  const state: PhysicsState = {
    distanceM: 0,
    elevationM: options.geometry.points[0]?.elevationM ?? 0,
    velocityMps: Math.max(0, options.initialSpeedMps ?? 0),
    elapsedSec: 0
  }
  const boundaryCrossings: { distanceM: number, elapsedSec: number }[] = []
  let boundaryIndex = 0

  // One rider object per power override segment, built once - the inner loop
  // only swaps references. `powerSegmentIndex` advances monotonically with
  // distance; the whole step uses the power at the step's START position (a
  // step is ≤ a few metres, far finer than any override segment).
  const powerSegments = options.powerSegmentsW
  const segmentRiders = powerSegments?.map(segment => ({ ...options.rider, powerW: segment.powerW }))
  let powerSegmentIndex = 0
  // Speed-dependent power (TTT draft) needs a fresh power value at every
  // force evaluation, twice per step. One reusable scratch object rather
  // than an allocation per evaluation - `calculateForces` only reads it, and
  // never retains it. `options.rider` itself is never mutated.
  const powerScaleAtSpeed = options.powerScaleAtSpeed
  const scaledRider = powerScaleAtSpeed ? { ...options.rider } : undefined
  const riderAtSpeed = (baseRider: PhysicsRider, speedMps: number) => {
    if (!powerScaleAtSpeed) return baseRider
    scaledRider!.powerW = baseRider.powerW * powerScaleAtSpeed(speedMps)
    return scaledRider!
  }
  // The steady-state early exit below extrapolates a constant speed to the
  // finish, which would silently skip any power change still ahead - never
  // take it before the last override boundary is behind us.
  const lastPowerBoundaryM = powerSegments?.length ? powerSegments[powerSegments.length - 1]!.toM : 0
  // Same rule for surface changes (issue #124): a join still ahead means a
  // different Crr ahead, and extrapolating the current surface's speed across
  // it skipped e.g. the Alpe segment's 1.5km of dirt entirely on the segment
  // endpoint's 2-point geometry. The last INTERIOR join is the guard - the
  // final segment's own `toM` is deliberately not treated as a boundary,
  // because measured surface data routinely stops a few metres short of the
  // official distance (see `routeGeometry.ts`'s trailing-gap note), and using
  // it would disable the exit on essentially every route for nothing.
  const surfaceSegments = options.geometry.surfaceSegments
  const lastSurfaceBoundaryM = surfaceSegments.length > 1 ? surfaceSegments[surfaceSegments.length - 2]!.toM : 0

  // Guard against a simulation that never reaches the finish line. It has to
  // scale with the route AND with `dt`, or a smaller `dt` silently truncates
  // a long route and returns a plausible-looking wrong time instead of an
  // error. The budget is the steps needed to cover the route at 0.1 m/s -
  // slow enough that even an absurdly underpowered rider grinding up the
  // Alpe still finishes, since a rider who genuinely stops instead exits via
  // the `distanceAdvanced <= 0` break below. Exceeding it means the
  // simulation is not converging, so fail loudly rather than returning a
  // partial result.
  const maxSteps = Math.ceil(options.geometry.totalDistanceM / (0.1 * dt)) + 1000
  let steps = 0
  while (state.distanceM < options.geometry.totalDistanceM) {
    if (steps++ >= maxSteps) {
      throw new Error(`Route simulation did not finish within ${maxSteps} steps (dtSec=${dt}, route ${options.geometry.totalDistanceM}m) - reached ${state.distanceM.toFixed(1)}m in ${state.elapsedSec.toFixed(1)}s`)
    }
    const segment = gradeSegmentAt(options.geometry, state.distanceM)
    if (!segment) break
    const surface = surfaceAt(options.geometry.surfaceSegments, state.distanceM)
    let stepRider = options.rider
    if (powerSegments) {
      while (powerSegmentIndex < powerSegments.length && powerSegments[powerSegmentIndex]!.toM <= state.distanceM) powerSegmentIndex++
      const powerSegment = powerSegments[powerSegmentIndex]
      if (powerSegment && powerSegment.fromM <= state.distanceM) stepRider = segmentRiders![powerSegmentIndex]!
    }
    const forces = calculateForces(state.velocityMps, segment.grade, riderAtSpeed(stepRider, state.velocityMps), physicsEquipment, surface, crrClass)
    const previousDistance = state.distanceM
    const previousElapsedSec = state.elapsedSec
    // Midpoint (RK2) velocity step: acceleration is evaluated again at the
    // half-step velocity rather than only at the start of the step. Plain
    // forward Euler overshoots badly while the rider is still accelerating
    // away from a standing start - drag grows with v^2, so holding the
    // start-of-step acceleration for the whole step credits speed the rider
    // never had. That overshoot cost a near-constant ~5.8s per route
    // regardless of length (it's a start-transient error, not a distributed
    // one); the midpoint step brings it to ~0.2s for one extra force
    // evaluation. Distance advances at the midpoint velocity to match.
    const previousVelocityMps = state.velocityMps
    const midVelocityMps = Math.max(0, previousVelocityMps + forces.accelerationMps2 * dt / 2)
    const midForces = calculateForces(midVelocityMps, segment.grade, riderAtSpeed(stepRider, midVelocityMps), physicsEquipment, surface, crrClass)
    state.velocityMps = Math.max(0, previousVelocityMps + midForces.accelerationMps2 * dt)
    // On the step that crosses the finish line the rider only rides part of
    // `dt` before finishing, so the clock advances by only that fraction -
    // charging the full `dt` quantises every finish time up to the next `dt`
    // boundary, which is the same order as the sub-second gaps between combos.
    const remainingM = options.geometry.totalDistanceM - previousDistance
    const stepDistanceM = midVelocityMps * dt
    const stepSec = stepDistanceM > remainingM ? dt * (remainingM / stepDistanceM) : dt
    const distanceAdvanced = Math.min(stepDistanceM, remainingM)
    state.distanceM = previousDistance + distanceAdvanced
    state.elevationM += segment.grade * distanceAdvanced
    state.elapsedSec += stepSec
    boundaryIndex = crossBoundaries(options.boundariesM, boundaryIndex, boundaryCrossings, previousDistance, previousElapsedSec, state.distanceM, state.elapsedSec)

    // Both boundary guards compare the step's START position, not where the
    // step landed: `forces` (whose near-zero acceleration is what justifies
    // extrapolating) were evaluated at the start, so a step that CROSSES the
    // last boundary is still carrying the old surface's/power's equilibrium -
    // exiting on it extrapolated the Alpe segment's dirt-converged speed over
    // 10km of tarmac (issue #124's verification caught this).
    if (state.velocityMps > 1 && Math.abs(forces.accelerationMps2) < 0.002 && segment.endDistanceM >= options.geometry.totalDistanceM && previousDistance >= lastPowerBoundaryM && previousDistance >= lastSurfaceBoundaryM) {
      const beforeRemainingDistance = state.distanceM
      const beforeRemainingElapsedSec = state.elapsedSec
      const remainingM = options.geometry.totalDistanceM - state.distanceM
      state.elapsedSec += remainingM / state.velocityMps
      state.distanceM = options.geometry.totalDistanceM
      state.elevationM += segment.grade * remainingM
      crossBoundaries(options.boundariesM, boundaryIndex, boundaryCrossings, beforeRemainingDistance, beforeRemainingElapsedSec, state.distanceM, state.elapsedSec)
      break
    }

    if (distanceAdvanced <= 0 && state.velocityMps <= 0) break
  }

  return {
    elapsedSec: state.elapsedSec,
    distanceM: state.distanceM,
    averageSpeedMps: state.elapsedSec > 0 ? state.distanceM / state.elapsedSec : 0,
    finalSpeedMps: state.velocityMps,
    state,
    boundaryCrossings: options.boundariesM ? boundaryCrossings : undefined
  }
}

/**
 * Compatibility 2-point geometry (straight-line average grade, one surface
 * for the whole route). Used as a base by `routeGeometry.ts` and directly by
 * `physics/validate.ts`. When a route has no measured per-position surface
 * data, this picks the single most prevalent surface from `route.surface.composition`
 * as a fallback - a coarse approximation, but better than always assuming tarmac.
 */
export function geometryFromRoute(route: RouteWithMeta): RouteGeometry {
  const totalDistanceM = route.distance * 1000
  const totalElevationM = route.elevation
  const dominantSurface = route.surface.composition
    ? Object.entries(route.surface.composition).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0]
    : undefined

  return {
    routeSlug: route.slug,
    totalDistanceM,
    points: [
      { distanceM: 0, elevationM: 0 },
      { distanceM: totalDistanceM, elevationM: totalElevationM }
    ],
    surfaceSegments: [
      { fromM: 0, toM: totalDistanceM, surface: (dominantSurface as PhysicsSurface) ?? 'tarmac' }
    ]
  }
}
