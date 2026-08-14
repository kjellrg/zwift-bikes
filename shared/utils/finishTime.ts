import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from '../types/catalog'
import { SURFACE_CRR } from '../data/surfaceCrr'
import { clampLaps } from './routeLaps'
import { equipmentPhysics, riderScaledCdaM2 } from './physics/equipment'
import { speedForPower } from './physics/forces'

/**
 * Rough physics-based estimate of how long a rider would take to finish a
 * route on a given frame+wheelset combo, given their weight and sustained
 * power output (expressed as W/kg, matching how Zwift riders usually think
 * about their own effort).
 *
 * This is a simplified constant-power/constant-speed model - it does NOT
 * simulate draft, pack dynamics, coasting on descents, or Zwift's exact
 * physics engine. It exists to give a *relative* "which combo is faster for
 * me on this route" comparison, not a precise real-world time prediction.
 *
 * Method: for a rider sustaining `wkg * weightKg` watts, solve the standard
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
// surface composition. Curated routes now provide `surface.composition`, so
// this remains mostly for older/unverified/heuristic route metadata.
const CRR_BY_CLASS: Record<'road' | 'gravel' | 'mountain', { road: number, gravel: number, cobble: number }> = {
  road: { road: 0.004, gravel: 0.016, cobble: 0.0065 },
  gravel: { road: 0.004, gravel: 0.008, cobble: 0.008 },
  mountain: { road: 0.004, gravel: 0.009, cobble: 0.009 }
}

function blendedCrr(wheelset: Wheelset | undefined, route: RouteWithMeta): number {
  // Fixed-wheel frames (see `hasFixedWheels`) don't have a real wheelset to
  // read a Crr class from - 'road' is a safe default since paved-road Crr
  // is identical across all classes anyway (only gravel/cobble differ), and
  // these frames are only ever ridden on paved TT courses in practice.
  const crrClass = wheelset?.crrClass ?? 'road'

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
 * Estimates finish time in seconds for a route ridden on a specific
 * frame+wheelset combo, by a rider of `weightKg`/`heightCm` sustaining `wkg`
 * watts/kg. `wheelset` is optional/ignored for `frame.hasFixedWheels` frames
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
 */
export function estimateFinishTimeSec(
  route: RouteWithMeta,
  frame: ClassifiedBikeFrame,
  wheelset: Wheelset | undefined,
  weightKg: number,
  heightCm: number,
  wkg: number,
  laps = 1
): number {
  const powerW = wkg * weightKg
  const grade = route.terrain.climbRatio / 1000 // m/km -> m/m

  const { cdaM2, bikeMassKg, crrDelta } = equipmentPhysics(frame, wheelset)
  const cda = riderScaledCdaM2(cdaM2, heightCm, weightKg)
  const massKg = weightKg + bikeMassKg
  const crr = Math.max(0, blendedCrr(wheelset, route) + (crrDelta ?? 0))

  const lapSpeedMs = speedForPower(powerW, massKg, grade, crr, cda)
  const effectiveLaps = clampLaps(route, laps)
  let totalTimeSec = (route.distance * 1000 / lapSpeedMs) * effectiveLaps

  if (route.leadInDistance) {
    const leadInGrade = (route.leadInElevation ?? 0) / (route.leadInDistance * 1000)
    const leadInSpeedMs = speedForPower(powerW, massKg, leadInGrade, crr, cda)
    totalTimeSec += (route.leadInDistance * 1000) / leadInSpeedMs
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
 */
export function estimateSurfaceTimePenaltySec(
  route: RouteWithMeta,
  frame: ClassifiedBikeFrame,
  wheelset: Wheelset | undefined,
  weightKg: number,
  heightCm: number,
  wkg: number,
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
  const actualTimeSec = estimateFinishTimeSec(route, frame, wheelset, weightKg, heightCm, wkg, laps)
  const pavedTimeSec = estimateFinishTimeSec(pavedRoute, frame, wheelset, weightKg, heightCm, wkg, laps)
  return actualTimeSec - pavedTimeSec
}
