import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from '../types/catalog'
import { SURFACE_CRR } from '../data/surfaceCrr'
import { clampLaps } from './routeLaps'
import { unmeasuredLeadInSurface } from './surfaceGeometry'
import { equipmentPhysics, riderScaledCdaM2 } from './physics/equipment'
import { speedForPower } from './physics/forces'
import { raceGroupSpeedMps, tttGroupSpeedMps } from './physics/draft'

/**
 * Rough physics-based estimate of how long a rider would take to finish a
 * route on a given frame+wheelset combo, given their weight and sustained
 * power output in absolute watts (matching the power sliders, which hold
 * watts constant when the rider's weight changes).
 *
 * This is a simplified constant-power/constant-speed model - it does NOT
 * simulate pack dynamics, coasting on descents, or Zwift's exact physics
 * engine. Draft enters only through the optional `draft` argument below, which
 * mirrors what the real simulator does for a Team Time Trial or a mass-start
 * race (see `physics/draft.ts`). It exists to give a *relative* "which combo is
 * faster for me on this route" comparison, not a precise real-world time
 * prediction.
 *
 * Method: for a rider sustaining `powerW` watts, solve the standard
 * cycling power-speed equation
 *
 *   P = (Crr * m * g * cos(theta) + m * g * sin(theta) + 0.5 * rho * CdA * v^2) * v / efficiency
 *
 * for velocity `v` via bisection (the equation isn't solvable in closed form
 * because of the v^3 aero term), then divide the route distance by v.
 *
 * - Grade (`theta`) comes from the route's average climb ratio (m of gain
 *   per km), applied uniformly - routes are climbed and descended at the
 *   same average grade in this simplified model rather than segment-by-segment.
 * - Crr (rolling resistance) is blended across the route's road/gravel/cobble
 *   surface mix, using the wheelset's real Zwift Crr class (see `classifyWheel.ts`).
 * - CdA and bike mass come from `physics/equipment.ts`'s `equipmentPhysics` -
 *   the same function the real per-segment dynamic simulator (`simulateRoute`)
 *   uses, so this cheap estimate and the accurate one never disagree about
 *   what a combo's CdA/mass actually are (see that file for the full history:
 *   why TT frames need their own baseline, why disc wheels get an extra TT-
 *   specific boost, and issue #11's fix deriving each measured frame/wheel's
 *   CdA/mass directly from its own real ZwiftInsider gap-seconds instead of a
 *   flat per-category multiplier).
 */

// Coarse fallback Crr values for routes without a detailed zwiftmap-style
// surface composition, derived from the same official per-surface table the
// composition path reads so the two can never drift (they had: this table
// once carried hand-typed values that disagreed with `SURFACE_CRR` for the
// gravel and mountain classes). Reachable only for `unverified`/`heuristic`
// routes, which always carry `gravel`/`cobble` at 0 (see `routeTerrain.ts`),
// so numerically it only ever contributes the tarmac term. The coarse
// "gravel" bucket maps to dirt, the surface Zwift's off-road routes are
// mostly made of, and "cobble" to cobbles.
const CRR_BY_CLASS: Record<'road' | 'gravel' | 'mountain', { road: number, gravel: number, cobble: number }> = {
  road: { road: SURFACE_CRR.tarmac.road!, gravel: SURFACE_CRR.dirt.road!, cobble: SURFACE_CRR.cobbles.road! },
  gravel: { road: SURFACE_CRR.tarmac.gravel!, gravel: SURFACE_CRR.dirt.gravel!, cobble: SURFACE_CRR.cobbles.gravel! },
  mountain: { road: SURFACE_CRR.tarmac.mountain!, gravel: SURFACE_CRR.dirt.mountain!, cobble: SURFACE_CRR.cobbles.mountain! }
}

// Fixed-wheel frames (see `hasFixedWheels`) don't have a real wheelset to
// read a Crr class from - 'road' is a safe default since paved-road Crr
// is identical across all classes anyway (only gravel/cobble differ), and
// these frames are only ever ridden on paved TT courses in practice.
const crrClassOf = (wheelset: Wheelset | undefined) => wheelset?.crrClass ?? 'road'

function blendedCrr(wheelset: Wheelset | undefined, route: RouteWithMeta): number {
  const crrClass = crrClassOf(wheelset)

  if (route.surface.composition) {
    return Object.entries(route.surface.composition).reduce((sum, [surface, percent]) => {
      const crr = SURFACE_CRR[surface as keyof typeof SURFACE_CRR][crrClass]
      // Every surface/class combo in `SURFACE_CRR` is populated with a real
      // ZwiftInsider-verified value as of this writing, so this only matters
      // if a future surface is added there before real data exists for it -
      // falls back to the mountain-bike value as a high, finite penalty so
      // rankings still sort instead of exploding to NaN.
      const effectiveCrr = crr ?? SURFACE_CRR.grass.mountain!
      return sum + effectiveCrr * ((percent ?? 0) / 100)
    }, 0)
  }

  const { road, gravel, cobble } = CRR_BY_CLASS[crrClass]
  const gravelFraction = route.surface.gravel / 100
  const cobbleFraction = route.surface.cobble / 100
  const roadFraction = Math.max(0, 1 - gravelFraction - cobbleFraction)
  return road * roadFraction + gravel * gravelFraction + cobble * cobbleFraction
}

/**
 * Crr for the lead-in, which is ridden once from the start pen and is not
 * part of the lap the surface composition describes. `unmeasuredLeadInSurface`
 * decides (paved pen, or inherit the lap when the lead-in is measured or the
 * world is one surface throughout); this is the same call
 * `geometryForRouteLaps` makes for the simulator, so the ranking key and the
 * displayed times agree about every lead-in.
 */
function leadInCrr(wheelset: Wheelset | undefined, route: RouteWithMeta): number {
  const surface = unmeasuredLeadInSurface(route.surface)
  return surface ? SURFACE_CRR[surface][crrClassOf(wheelset)]! : blendedCrr(wheelset, route)
}

/**
 * Estimates finish time in seconds for a route ridden on a specific
 * frame+wheelset combo, by a rider of `weightKg`/`heightCm` sustaining
 * `powerW` watts. `wheelset` is optional/ignored for `frame.hasFixedWheels` frames
 * (no real wheel choice - see `classifyBikeFrame.ts`).
 *
 * `laps` (default 1, clamped via `clampLaps` - forced to 1 for non-lap
 * routes) repeats the route's own distance/grade `laps` times, while the
 * route's `leadInDistance`/`leadInElevation` (if any) is only ridden ONCE
 * regardless of lap count, matching how Zwift races actually work (ride the
 * lead-in once, then complete N laps of the course). The lead-in's own
 * grade is computed separately from its own elevation/distance rather than
 * reusing the lap's grade, since a short lead-in can have a very different
 * gradient than the lap itself.
 *
 * `draft` mirrors what `simulateRoute` does for the same mode, so the cheap
 * estimate (the full-pool ranking key) keeps tracking the simulator (the
 * displayed times) and the `orderBySimulatedTime` window still catches every
 * real contender:
 *
 * - `{ mode: 'ttt', riders }` makes every speed solve a `tttGroupSpeedMps`
 *   fixed point rather than a plain `speedForPower` - each rider averages
 *   `powerW`, and the group moves at the speed their combined effort produces.
 * - `{ mode: 'ttt', climb }` (the aggregate of `tttPowerPlan`'s blocks over the
 *   WHOLE ride, laps and lead-in included) additionally splits the estimate
 *   into two closed-form phases: the plan's climb distance at the team climb
 *   power on the climbs' own average grade, the remainder at `powerW` on the
 *   remaining average grade.
 * - `{ mode: 'race' }` solves `raceGroupSpeedMps` instead - one field-calibrated
 *   saving, no rider count and no power plan, because race mode has neither
 *   (see `RACE_DRAFT_SAVING`).
 *
 * A discriminated union rather than one flag per mode so a fourth draft mode is
 * a new arm here instead of a new parameter at every call site. When `draft` is
 * unset this function is unchanged, so solo-mode ordering cannot drift by
 * construction.
 */
export function estimateFinishTimeSec(
  route: RouteWithMeta,
  frame: ClassifiedBikeFrame,
  wheelset: Wheelset | undefined,
  weightKg: number,
  heightCm: number,
  powerW: number,
  laps = 1,
  draft?: { mode: 'ttt', riders: number, climb?: { distanceM: number, elevationM: number, powerW: number } } | { mode: 'race' }
): number {
  const grade = route.terrain.climbRatio / 1000 // m/km -> m/m

  const { cdaM2, bikeMassKg, crrDelta } = equipmentPhysics(frame, wheelset)
  const cda = riderScaledCdaM2(cdaM2, heightCm, weightKg)
  const massKg = weightKg + bikeMassKg
  const crr = Math.max(0, blendedCrr(wheelset, route) + (crrDelta ?? 0))
  const leadInCrrValue = Math.max(0, leadInCrr(wheelset, route) + (crrDelta ?? 0))

  const effectiveLaps = clampLaps(route, laps)
  // One speed solver for every mode, so no drafted path can drift from the solo
  // path in anything except the draft benefit itself.
  const solveSpeedMs = (atPowerW: number, atGrade: number, atCrr = crr) => draft?.mode === 'ttt'
    ? tttGroupSpeedMps(atPowerW, draft.riders, massKg, atGrade, atCrr, cda)
    : draft?.mode === 'race'
      ? raceGroupSpeedMps(atPowerW, massKg, atGrade, atCrr, cda)
      : speedForPower(atPowerW, massKg, atGrade, atCrr, cda)

  const tttClimb = draft?.mode === 'ttt' ? draft.climb : undefined
  if (tttClimb && tttClimb.distanceM > 0) {
    const lapDistanceM = route.distance * 1000 * effectiveLaps
    const leadInDistanceM = (route.leadInDistance ?? 0) * 1000
    const leadInElevationM = route.leadInDistance ? (route.leadInElevation ?? 0) : 0
    const totalDistanceM = lapDistanceM + leadInDistanceM
    // The same "uniform average grade" simplification as the solo path, with
    // the modeled total ascent (lap climb ratio × distance, plus the lead-in's
    // own gain) split between the climb phase and everything else. The
    // lead-in's own Crr is folded into the lap blend here: the two-phase
    // split already loses which metres are lead-in, and the TTT ordering
    // window (`SIMULATED_ORDER_MARGIN`) absorbs the few seconds of drift.
    const modeledAscentM = grade * lapDistanceM + leadInElevationM
    const climbDistanceM = Math.min(tttClimb.distanceM, totalDistanceM)
    const climbGrade = tttClimb.elevationM / climbDistanceM
    const remainderDistanceM = totalDistanceM - climbDistanceM
    const remainderGrade = remainderDistanceM > 0 ? Math.max(0, modeledAscentM - tttClimb.elevationM) / remainderDistanceM : 0
    let totalTimeSec = climbDistanceM / solveSpeedMs(tttClimb.powerW, climbGrade)
    if (remainderDistanceM > 0) totalTimeSec += remainderDistanceM / solveSpeedMs(powerW, remainderGrade)
    return totalTimeSec
  }

  const lapSpeedMs = solveSpeedMs(powerW, grade)
  let totalTimeSec = (route.distance * 1000 / lapSpeedMs) * effectiveLaps

  if (route.leadInDistance) {
    const leadInGrade = (route.leadInElevation ?? 0) / (route.leadInDistance * 1000)
    totalTimeSec += (route.leadInDistance * 1000) / solveSpeedMs(powerW, leadInGrade, leadInCrrValue)
  }

  return totalTimeSec
}

/**
 * How many extra seconds a route's gravel/cobble sections cost a specific
 * combo, compared to riding the exact same distance/grade fully paved -
 * i.e. `estimateFinishTimeSec(route, ...) - estimateFinishTimeSec(pavedRoute, ...)`.
 * Isolates the rolling-resistance (Crr) effect from `blendedCrr` since
 * everything else (grade, mass, CdA) is identical between the two calls.
 * Returns `0` for routes with no known gravel/cobble (`estimateSurface`'s
 * `'unverified'`/`'heuristic'` confidence levels always have `gravel`/`cobble`
 * at 0, so this is a no-op for them too - see `routeTerrain.ts`).
 * Deliberately draft-free in every draft mode: it's a Crr-isolation delta, and
 * both compared rides would share the same draft benefit anyway.
 */
export function estimateSurfaceTimePenaltySec(
  route: RouteWithMeta,
  frame: ClassifiedBikeFrame,
  wheelset: Wheelset | undefined,
  weightKg: number,
  heightCm: number,
  powerW: number,
  laps = 1
): number {
  if (route.surface.gravel === 0 && route.surface.cobble === 0) return 0

  const pavedRoute: RouteWithMeta = {
    ...route,
    surface: {
      road: 100,
      gravel: 0,
      cobble: 0,
      composition: route.surface.composition ? { tarmac: 100 } : undefined,
      confidence: route.surface.confidence
    }
  }
  const actualTimeSec = estimateFinishTimeSec(route, frame, wheelset, weightKg, heightCm, powerW, laps)
  const pavedTimeSec = estimateFinishTimeSec(pavedRoute, frame, wheelset, weightKg, heightCm, powerW, laps)
  return actualTimeSec - pavedTimeSec
}
