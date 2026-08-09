import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from '../types/catalog'
import { blend } from './scoring'
import { clampLaps } from './routeLaps'

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
 * - CdA (frontal area x drag coefficient) is derived from the combo's
 *   blended aero score (0-100) - a higher aero score maps to a lower CdA.
 * - Bike mass is derived from the combo's blended climb score (0-100) - a
 *   higher climb score maps to a lower effective mass. Without this, the
 *   model only rewarded low CdA and used a fixed bike mass for every combo,
 *   so a TT frame's low CdA would make it look like the fastest choice even
 *   on the steepest climbs, despite TT frames scoring far worse on `climb`
 *   (see `ClassificationScores.climb`'s "how much the equipment helps when
 *   climbing, i.e. low weight" doc comment) - contradicting real Zwift/road
 *   racing, where TT bikes are known to be poor climbers and are avoided on
 *   routes like Alpe du Zwift ("Road to Sky").
 */

const AIR_DENSITY = 1.225 // kg/m^3, sea-level standard
const GRAVITY = 9.807 // m/s^2
const DRIVETRAIN_EFFICIENCY = 0.975
const BASE_BIKE_MASS_KG = 8 // kg, roughly a mid-pack road bike + accessories
const CLIMB_MASS_SENSITIVITY = 0.4 // fraction of BASE_BIKE_MASS_KG swung across the full 0-100 climb score range

// Like `TT_CDA_MULTIPLIER` below, `standard`/`tt` climb scores are each
// normalized against their OWN gap range (`CLIMB_GAP_RANGE` vs
// `TT_CLIMB_GAP_RANGE` in `classifyBikeFrame.ts`), measured against
// different baseline bikes ("Zwift Carbon" vs "Zwift TT") - so a TT frame
// scoring e.g. 95 and a road frame scoring 94 are NOT equally good climbers
// in absolute terms, the same cross-baseline caveat `TT_CDA_MULTIPLIER`
// already documents for aero. Without a correction here, a small number of
// exceptionally well-reviewed TT frames (e.g. the Canyon Speedmax CFR,
// zwiftinsider.com/charts-tt/: "the fastest TT frame on any road" and
// "the only TT frame rated 2 stars for weight") score high enough on their
// own TT-relative scale to out-climb genuinely lighter road climbing frames
// once blended with their aero advantage - contradicting the well-established
// fact that TT bikes are poor climbers overall (zwiftinsider.com/tron-bike/:
// the Tron bike - itself lighter/faster than most TT frames - "is not the
// fastest bike for climbing... not by a long shot. It loses around 40
// seconds across an hour of climbing when compared with a top climbing
// setup."). This applies a fixed heavier effective mass to TT frames on top
// of their own (still relatively-ranked) climb score, so a strong TT climber
// remains better than a weak one, but TT frames as a category no longer
// out-climb dedicated road climbing frames. Since actual TT frames are
// heavier and worse climbers than the (non-TT) Tron bike, the ~40 sec/hour
// Tron-vs-top-climbing-setup gap above is a floor, not a target - simulating
// this model on Road to Sky (a real mountainous route, ~6% average grade)
// at a competitive 4 W/kg showed a multiplier of 1.2 wasn't enough to
// overcome a top TT frame's aero advantage (it still finished ~1-3 sec
// ahead of the top road climbing frame); 1.5 produces a ~47 sec gap over
// that same climb (~51 sec/hour), comfortably past the Tron-bike floor.
//
// **Bug found + fixed (user-reported): TT bikes still showed as faster than
// road bikes on genuinely "hilly"-category routes (e.g. Achterbahn, ~2%
// average grade) that are much less steep than Road to Sky.** 1.5 only
// reliably kept TT off the top on very steep (~6%+) sustained climbs -
// simulating the model across a range of real routes (climbRatio 0-60 m/km)
// and power levels (2.5-5 W/kg) showed TT frames still won outright on every
// "hilly"-category route tested (~1.5-2% avg grade) at every power level.
// Bumped to 2.0: still preserves TT's correct, well-established dominance on
// every flat/rolling route at every power level (per ZwiftInsider: "TT bikes
// are always faster than road bikes in non-drafting flat or rolling
// situations"), while flipping "hilly" routes to favor road climbing frames
// at recreational-to-competitive power (2.5-4.5 W/kg) - TT only creeps back
// ahead on hilly routes at elite-level power (~5 W/kg+), which is physically
// reasonable (aero drag scales with v^3, so higher speed increasingly favors
// aero over weight even on a moderate grade) rather than a bug. Mountainous
// routes (Road to Sky) still favor road frames by an even wider margin than
// before at every power level - no regression there. Like `TT_CDA_MULTIPLIER`,
// this is a documented approximation, not an exact published cross-baseline
// figure - revisit if ZwiftInsider ever publishes a direct TT-vs-road climb
// comparison on the same course.
const TT_CLIMB_MASS_MULTIPLIER = 2.0

const BASE_CDA = 0.32 // m^2, roughly a mid-pack road position
const AERO_SENSITIVITY = 0.12 // fraction of CdA swung across the full 0-100 aero score range

// `standard`/`gravel`/`tt` frame aero/climb scores each come from real bot-test
// data, but the `standard` and `tt` tables are measured against DIFFERENT
// baseline bikes ("Zwift Carbon" vs "Zwift TT"), then independently
// normalized to their own 0-100 range (see `classifyBikeFrame.ts`). That means
// a TT frame scoring e.g. 91 and a road frame scoring 94 are NOT on a directly
// comparable absolute scale - without this correction, TT bikes would show
// ~the same finish time as top road bikes, which is wrong: ZwiftInsider
// confirms TT bikes are always faster than road bikes in non-drafting
// flat/rolling riding (even faster than the Tron bike, which itself beats the
// road baseline bike by 114.6 sec/hour - see zwiftinsider.com/tron-bike).
// This applies a fixed ~13% lower CdA baseline for TT frames, derived from
// that public data point, on top of the normal within-category score-based
// adjustment. It's an approximation (Zwift doesn't publish an exact
// cross-baseline number), but corrects the direction and rough magnitude of
// the error.
const TT_CDA_MULTIPLIER = 0.87

// Disc wheels get a SPECIFIC extra aero boost on TT frames, on top of the
// general TT frame boost above - confirmed with exact ZwiftInsider per-wheel
// Road-vs-TT data (zwiftinsider.com/wheel/dt-swiss-arc-1100-dicut-85-disc,
// /wheel/swiss-side-hadron-ultimate-650, /wheel/swiss-side-hadron-ultimate-850-disc):
// a non-disc wheel (Swiss Side HADRON Ultimate 650) saves 46.8s/hour on Road
// vs 52.8s/hour on TT (+12.8%), while a disc wheel (DT Swiss ARC 1100 DICUT
// 85/Disc, identical numbers for Swiss Side HADRON Ultimate 850/Disc) saves
// 50s/hour on Road vs 68.6s/hour on TT (+37.2%) - i.e. the disc wheel's OWN
// specific TT advantage over a non-disc wheel is 68.6 - 52.8 = 15.8
// sec/hour, not a huge gap.
//
// **Bug found + fixed (user-reported): this specific disc-vs-non-disc gap
// was showing as ~1:40 (100+ sec) over a ~35 min TT route, when real-world
// sources put it at ~5-10 sec over a similar ride.** Root cause: an earlier
// version of this constant (0.82) was derived as a ratio-of-ratios
// (1.128/1.372) and then applied as a flat multiplier on `baseCda` -
// but `baseCda` represents the CdA of the ENTIRE rider+frame+wheels system,
// while the 46.8/52.8/50/68.6 sec/hour figures are the WHEEL's own total
// measured gap, a small fraction of the whole system's drag. Multiplying
// the *entire* system CdA by that ratio (an extra ~18% reduction) massively
// overstated a wheel-only effect. Corrected by solving for the actual CdA
// this data implies via the same `speedForPower` bisection model used
// everywhere else in this file, at ZwiftInsider's 300W bot-test protocol:
// starting from the non-disc TT CdA this model already computes from
// aero score alone (no disc multiplier), the disc wheel's real 15.8
// sec/hour extra TT advantage only requires roughly a further ~3% CdA
// reduction - not ~18%. Verified the corrected value reproduces a ~7-10
// sec gap (not ~100 sec) between DTSwiss ARC 1100 DICUT 85/Disc and
// DTSwiss ARC 1100 DICUT 65 on the same TT frame over a real ~35 min route.
const TT_DISC_CDA_MULTIPLIER = 0.97

// Real Zwift Crr values per wheel class and surface type (see
// `classifyWheel.ts`'s CRR_COBBLE_SCORE/CRR_GRAVEL_SCORE comment for the
// ZwiftInsider source). Paved-road Crr is effectively identical across
// classes in Zwift, so only the off-road cases differentiate.
const CRR_BY_CLASS: Record<'road' | 'gravel' | 'mountain', { road: number, gravel: number, cobble: number }> = {
  road: { road: 0.004, gravel: 0.016, cobble: 0.0065 },
  gravel: { road: 0.004, gravel: 0.008, cobble: 0.008 },
  mountain: { road: 0.004, gravel: 0.009, cobble: 0.009 }
}

function cdaFromAeroScore(aeroScore: number, isTT: boolean, isDiscWheel: boolean): number {
  const normalized = (aeroScore - 50) / 50 // roughly -1 (worst) .. +1 (best)
  let baseCda = BASE_CDA
  if (isTT) {
    baseCda *= TT_CDA_MULTIPLIER
    if (isDiscWheel) baseCda *= TT_DISC_CDA_MULTIPLIER
  }
  return baseCda * (1 - normalized * AERO_SENSITIVITY)
}

function bikeMassFromClimbScore(climbScore: number, isTT: boolean): number {
  const normalized = (climbScore - 50) / 50 // roughly -1 (worst) .. +1 (best)
  const mass = BASE_BIKE_MASS_KG * (1 - normalized * CLIMB_MASS_SENSITIVITY)
  return isTT ? mass * TT_CLIMB_MASS_MULTIPLIER : mass
}

function blendedCrr(wheelset: Wheelset | undefined, route: RouteWithMeta): number {
  // Fixed-wheel frames (see `hasFixedWheels`) don't have a real wheelset to
  // read a Crr class from - 'road' is a safe default since paved-road Crr
  // is identical across all classes anyway (only gravel/cobble differ), and
  // these frames are only ever ridden on paved TT courses in practice.
  const { road, gravel, cobble } = CRR_BY_CLASS[wheelset?.crrClass ?? 'road']
  const gravelFraction = route.surface.gravel / 100
  const cobbleFraction = route.surface.cobble / 100
  const roadFraction = Math.max(0, 1 - gravelFraction - cobbleFraction)
  return road * roadFraction + gravel * gravelFraction + cobble * cobbleFraction
}

function speedForPower(powerW: number, massKg: number, grade: number, crr: number, cda: number): number {
  const cosTheta = Math.cos(Math.atan(grade))
  const sinTheta = Math.sin(Math.atan(grade))
  const rollingAndGravity = crr * massKg * GRAVITY * cosTheta + massKg * GRAVITY * sinTheta

  const powerAtSpeed = (v: number) => (rollingAndGravity * v + 0.5 * AIR_DENSITY * cda * v ** 3) / DRIVETRAIN_EFFICIENCY

  let low = 0.1
  let high = 30 // m/s, ~108 km/h ceiling
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    if (powerAtSpeed(mid) < powerW) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/**
 * Estimates finish time in seconds for a route ridden on a specific
 * frame+wheelset combo, by a rider of `weightKg` sustaining `wkg` watts/kg.
 * `wheelset` is optional/ignored for `frame.hasFixedWheels` frames (no real
 * wheel choice - see `classifyBikeFrame.ts`).
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
  wkg: number,
  laps = 1
): number {
  const powerW = wkg * weightKg
  const grade = route.terrain.climbRatio / 1000 // m/km -> m/m

  // Frames with fixed (non-swappable) wheels already have their integrated
  // wheel's aero/climb contribution baked into their own measured data - see
  // `classifyBikeFrame.ts`'s `FIXED_WHEEL_FRAMES` comment. Blending in
  // whatever wheelset they happen to be paired with (and the disc-specific
  // TT bonus below, which assumes a separately-selected disc wheel product)
  // would double-count that effect.
  const combinedAero = frame.hasFixedWheels || !wheelset ? frame.scores.aero : blend(frame.scores.aero, wheelset.scores.aero)
  const combinedClimb = frame.hasFixedWheels || !wheelset ? frame.scores.climb : blend(frame.scores.climb, wheelset.scores.climb)
  const cda = cdaFromAeroScore(combinedAero, frame.category === 'tt', !frame.hasFixedWheels && wheelset?.front.category === 'disc')
  const bikeMassKg = bikeMassFromClimbScore(combinedClimb, frame.category === 'tt')
  const massKg = weightKg + bikeMassKg
  const crr = blendedCrr(wheelset, route)

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
