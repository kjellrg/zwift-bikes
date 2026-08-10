import type { ClassifiedBikeFrame, EquipmentPhysicsDelta, Wheelset } from '../../types/catalog'
import type { MeasuredEquipmentGap, PhysicsParameters, PhysicsRider } from '../../types/physics'
import { calculateForces } from './forces'

const BASE_BIKE_MASS_KG = 8
const CLIMB_MASS_SENSITIVITY = 0.4
const BASE_EQUIPMENT_CDA = 0.32
const AERO_SENSITIVITY = 0.12
// Fallback-path (score-based) constants - still used for frames/wheels
// without real gap-seconds data (`confidence === 'estimated'`). Measured
// frames/wheels instead go through `solveFrameEquipmentDelta`/
// `solveWheelEquipmentDelta` below, which supersede these two multipliers by
// using them once, as a baseline anchor, instead of on every frame - see
// `TT_BASELINE_CDA_M2`/`TT_BASELINE_BIKE_MASS_KG`.
const TT_CDA_MULTIPLIER = 0.87
const TT_DISC_CDA_MULTIPLIER = 0.97
const TT_CLIMB_MASS_MULTIPLIER = 2.0

function normalizeScore(score: number): number {
  return (score - 50) / 50
}

export function bikeMassFromScore(climbScore: number, isTT: boolean): number {
  const mass = BASE_BIKE_MASS_KG * (1 - normalizeScore(climbScore) * CLIMB_MASS_SENSITIVITY)
  return isTT ? mass * TT_CLIMB_MASS_MULTIPLIER : mass
}

/**
 * `climbScore` is measured against a different baseline for TT frames than
 * for standard ones (see `classifyBikeFrame.ts`'s `TT_CLIMB_GAP_RANGE` vs
 * `CLIMB_GAP_RANGE`), so a TT frame scoring e.g. 65 is NOT "as good a
 * climber" as a standard frame scoring 65 - `bikeMassFromScore` already
 * corrects for this via `TT_CLIMB_MASS_MULTIPLIER` when computing real
 * dynamic-physics finish times. `scoreCombo` (`scoring.ts`) is a cheap 0-100
 * heuristic that never runs that physics, so without this it compared raw
 * TT and standard climb scores at face value - letting TT frames rank
 * competitively with (or above) genuine road climbers on climb-heavy
 * routes, contradicting the real simulated finish times (verified: on
 * Lutscher, a Canyon Speedmax CFR combo scored *higher* than a Tarmac SL7
 * SRAM combo despite finishing ~136s slower). This returns the
 * standard-scale climb score that would produce the SAME effective bike
 * mass as `bikeMassFromScore(climbScore, true)`, so the heuristic score
 * applies the identical, already-calibrated TT climb penalty instead of a
 * separately-invented one.
 */
export function standardEquivalentClimbScore(climbScore: number, isTT: boolean): number {
  if (!isTT) return climbScore
  const massKg = bikeMassFromScore(climbScore, true)
  const normalized = (1 - massKg / BASE_BIKE_MASS_KG) / CLIMB_MASS_SENSITIVITY
  return Math.max(0, Math.min(100, 50 + normalized * 50))
}

export function equipmentCdaFromScore(aeroScore: number, isTT: boolean, isDiscWheel: boolean): number {
  let cda = BASE_EQUIPMENT_CDA
  if (isTT) {
    cda *= TT_CDA_MULTIPLIER
    if (isDiscWheel) cda *= TT_DISC_CDA_MULTIPLIER
  }
  return cda * (1 - normalizeScore(aeroScore) * AERO_SENSITIVITY)
}

/**
 * Estimate rider frontal area from height and mass, using the Faria et al.
 * (2005) cycling frontal-area regression (FA = 0.0293*H^0.725*M^0.425 + 0.0604,
 * H in meters, M in kg) - the same formula zwifterbikes.com/gribble.org use
 * for this exact purpose, reverse-engineered against ZwiftInsider's own
 * bot-test data.
 *
 * An earlier version used the Du Bois body-surface-area equation (which
 * returns total BSA, not frontal area) scaled by an ad hoc 0.23 fraction and
 * a further ad hoc 0.88 "body Cd" multiplier - a quick fix for a prior bug
 * where BSA was used directly as frontal area (~1.7 m² of CdA for an average
 * rider). That fix restored a plausible-looking magnitude but was never
 * validated against real data: for a 75kg/183cm rider it produced ~0.398 m²
 * of rider CdA vs Faria's ~0.345 m² - ~13% too much aerodynamic drag.
 * Verified against a real-world discrepancy report (Tick Tock, a ~flat
 * Watopia route: zwifterbikes.com showed ~42 km/h for the fastest TT
 * combo at ZwiftInsider's 300W/75kg bot-test protocol, this app showed
 * ~36.9 km/h) - switching to the Faria formula raised the predicted
 * steady-state speed for the same combo/route/power from ~40.0 km/h to
 * ~41.9 km/h, within 0.15 km/h of zwifterbikes' figure.
 */
export function riderFrontalAreaM2(heightCm: number, weightKg: number): number {
  const heightM = Math.max(1, heightCm) / 100
  const mass = Math.max(30, weightKg)
  return 0.0293 * Math.pow(heightM, 0.725) * Math.pow(mass, 0.425) + 0.0604
}

export function riderCdaM2(heightCm: number, weightKg: number): number {
  return riderFrontalAreaM2(heightCm, weightKg)
}

/**
 * Scales a specific rider's own CdA by the equipment's fractional deviation
 * from `BASE_EQUIPMENT_CDA` ("an average rider's" system CdA) - i.e. a
 * combo's aero advantage/penalty is applied proportionally to the actual
 * rider's frontal area, not as a fixed absolute CdA that ignores who's
 * riding. Shared by `simulateRoute` and `finishTime.ts`'s cheap estimate so
 * both models treat rider height/weight identically.
 */
export function riderScaledCdaM2(equipmentCdaM2: number, heightCm: number, weightKg: number): number {
  return riderCdaM2(heightCm, weightKg) * (equipmentCdaM2 / BASE_EQUIPMENT_CDA)
}

// --- Solve absolute CdA/mass deltas directly from real ZwiftInsider gap-seconds ---
//
// `FRAME_SPEED_DATA`/`TT_FRAME_SPEED_DATA`/`WHEEL_SPEED_DATA` already give
// each measured frame/wheel's real seconds-saved-or-lost-per-hour vs. its
// baseline, at ZwiftInsider's own bot-test protocol. Rather than convert that
// into an abstract 0-100 score and then back into CdA/mass via a flat linear
// sensitivity constant (`AERO_SENSITIVITY`/`CLIMB_MASS_SENSITIVITY` above -
// the compounding-approximation-error root cause behind
// github.com/.../issues/11), solve for the CdA/mass delta that actually
// reproduces the measured gap, using the same forward physics
// (`calculateForces`) the rest of this app already trusts.

// ZwiftInsider's bot-test protocol (see `shared/data/frameSpeedData.ts`/
// `wheelSpeedData.ts` headers, confirmed via zwiftinsider.com): 75kg/183cm
// rider, 300W steady, no draft.
const BOT_POWER_W = 300
const BOT_RIDER_WEIGHT_KG = 75
const BOT_RIDER_HEIGHT_CM = 183

// The two courses ZwiftInsider bot-tests every frame/wheel on: Tempus Fugit
// (Watopia, 17.231km/26m elevation - "the flattest route on Zwift") for the
// aero/flat test, and Alpe du Zwift (~12.4km/~1036m, Zwift's replica of Alpe
// d'Huez) for the weight/climb test.
const FLAT_TEST_GRADE = 26 / 17231
const CLIMB_TEST_GRADE = 1036 / 12400

// The absolute system CdA/mass that `FRAME_SPEED_DATA`'s gap-seconds are
// relative to (a Stage-0 "Zwift Carbon" + "Zwift 32mm Carbon" bot rider) -
// reuses the same numbers the score-based fallback above already treats as
// "an average bike", so both paths agree on what a 0-gap frame means.
const STANDARD_BASELINE_CDA_M2 = BASE_EQUIPMENT_CDA
const STANDARD_BASELINE_BIKE_MASS_KG = BASE_BIKE_MASS_KG

// The TT baseline ("Zwift TT" + "Zwift 32mm Carbon") is NOT on the same
// absolute scale as the standard baseline, and Zwift has never published a
// real cross-baseline number (see the pre-existing `TT_CDA_MULTIPLIER`/
// `TT_CLIMB_MASS_MULTIPLIER` history above). Reuses those same two
// already-validated constants, but as a ONE-TIME anchor placing the TT
// reference bike relative to the standard one - not as a flat multiplier
// re-applied to every individual TT frame's already-lossy score-derived
// CdA/mass, which is what produced issue #11's Lady Liberty gap. Verified
// (scratch calibration script, see PR): with this anchor, the best real TT
// frame (Canyon Speedmax CFR, Stage 5) beats the standard baseline by ~223
// sec/hour on the bot-test flat course - safely past the Tron bike's real,
// published 114.6 sec/hour edge over that same baseline
// (zwiftinsider.com/tron-bike) - and TT stops beating the best standard
// frame on Achterbahn (climbRatio ~21 m/km) at recreational/competitive
// power, only creeping back ahead near elite power - the same behavior
// `TT_CLIMB_MASS_MULTIPLIER` was originally tuned to produce, now reproduced
// via real per-frame physics instead of a per-frame score multiplier.
const TT_BASELINE_CDA_M2 = STANDARD_BASELINE_CDA_M2 * TT_CDA_MULTIPLIER
const TT_BASELINE_BIKE_MASS_KG = STANDARD_BASELINE_BIKE_MASS_KG * TT_CLIMB_MASS_MULTIPLIER

/** Steady-state speed for constant power on constant grade, via bisection on `calculateForces`' net force. */
function steadyStateSpeedMps(powerW: number, bikeMassKg: number, grade: number, cdaM2: number): number {
  const rider: PhysicsRider = { weightKg: BOT_RIDER_WEIGHT_KG, heightCm: BOT_RIDER_HEIGHT_CM, powerW }
  const parameters: PhysicsParameters = { bikeMassKg, cdaM2 }
  let low = 0.1
  let high = 30 // m/s, ~108 km/h ceiling
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    const { netN } = calculateForces(mid, grade, rider, parameters, 'tarmac', 'road')
    if (netN > 0) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/** A gap of `gapSec` seconds saved/lost per hour at constant power implies this speed ratio vs. the baseline. */
function speedFromGapSec(gapSec: number, baselineSpeedMps: number): number {
  return baselineSpeedMps / (1 - gapSec / 3600)
}

/**
 * Solves the `(cdaDeltaM2, bikeMassDeltaKg)` that, added to
 * `baselineCdaM2`/`baselineBikeMassKg`, reproduces `gap`'s real measured
 * flat/climb speed advantage over that baseline at the bot-test protocol.
 * Two equations (flat speed, climb speed), two unknowns - solved by nesting
 * one bisection (mass, holding CdA fixed, since climb speed is
 * monotonically decreasing in mass) inside another (CdA, since flat speed is
 * monotonically decreasing in CdA once the inner mass solve keeps climb
 * speed pinned to its target).
 */
function solveEquipmentDelta(gap: MeasuredEquipmentGap, baselineCdaM2: number, baselineBikeMassKg: number): EquipmentPhysicsDelta {
  const baselineFlatSpeed = steadyStateSpeedMps(BOT_POWER_W, baselineBikeMassKg, FLAT_TEST_GRADE, baselineCdaM2)
  const baselineClimbSpeed = steadyStateSpeedMps(BOT_POWER_W, baselineBikeMassKg, CLIMB_TEST_GRADE, baselineCdaM2)
  const targetFlatSpeed = speedFromGapSec(gap.flatGapSec, baselineFlatSpeed)
  const targetClimbSpeed = speedFromGapSec(gap.climbGapSec, baselineClimbSpeed)

  function bikeMassDeltaForClimb(cdaDeltaM2: number): number {
    let low = -baselineBikeMassKg * 0.9
    let high = baselineBikeMassKg * 3
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2
      const speed = steadyStateSpeedMps(BOT_POWER_W, baselineBikeMassKg + mid, CLIMB_TEST_GRADE, baselineCdaM2 + cdaDeltaM2)
      if (speed > targetClimbSpeed) low = mid
      else high = mid
    }
    return (low + high) / 2
  }

  function flatResidual(cdaDeltaM2: number): number {
    const bikeMassDeltaKg = bikeMassDeltaForClimb(cdaDeltaM2)
    return steadyStateSpeedMps(BOT_POWER_W, baselineBikeMassKg + bikeMassDeltaKg, FLAT_TEST_GRADE, baselineCdaM2 + cdaDeltaM2) - targetFlatSpeed
  }

  let cdaLow = -baselineCdaM2 * 0.9
  let cdaHigh = baselineCdaM2 * 3
  for (let i = 0; i < 60; i++) {
    const mid = (cdaLow + cdaHigh) / 2
    if (flatResidual(mid) > 0) cdaLow = mid
    else cdaHigh = mid
  }
  const cdaDeltaM2 = (cdaLow + cdaHigh) / 2
  return { cdaDeltaM2, bikeMassDeltaKg: bikeMassDeltaForClimb(cdaDeltaM2) }
}

/** Solves a frame's own CdA/mass delta from its real gap-seconds, relative to its category's baseline. */
export function solveFrameEquipmentDelta(gap: MeasuredEquipmentGap, isTT: boolean): EquipmentPhysicsDelta {
  return isTT
    ? solveEquipmentDelta(gap, TT_BASELINE_CDA_M2, TT_BASELINE_BIKE_MASS_KG)
    : solveEquipmentDelta(gap, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG)
}

/**
 * Solves a wheel's own CdA/mass delta from its real gap-seconds.
 * `WHEEL_SPEED_DATA` is measured on the standard reference frame regardless
 * of which frame the wheel ends up paired with in a combo - additive on top
 * of whichever frame delta it's combined with in `equipmentPhysics`.
 */
export function solveWheelEquipmentDelta(gap: MeasuredEquipmentGap): EquipmentPhysicsDelta {
  return solveEquipmentDelta(gap, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG)
}

// The disc wheel's OWN specific TT-vs-road aero interaction - a real,
// ZwiftInsider-confirmed 15.8 sec/hour extra advantage a disc wheel gets
// specifically on a TT frame, beyond its own already-measured road-tested
// aero gap (see the historical `TT_DISC_CDA_MULTIPLIER` investigation this
// replaces: zwiftinsider.com/wheel/dt-swiss-arc-1100-dicut-85-disc,
// /wheel/swiss-side-hadron-ultimate-650/850-disc). This is a genuine
// frame/wheel aerodynamic interaction, not two independently-additive drag
// sources, so plain frame-delta + wheel-delta addition can't capture it -
// solved once, directly, as its own residual CdA delta at the TT baseline
// (flat-only; no climb data exists for this specific interaction).
const TT_DISC_RESIDUAL_CDA_DELTA_M2 = solveEquipmentDelta({ flatGapSec: 15.8, climbGapSec: 0 }, TT_BASELINE_CDA_M2, TT_BASELINE_BIKE_MASS_KG).cdaDeltaM2

export function equipmentPhysics(frame: ClassifiedBikeFrame, wheelset?: Wheelset): PhysicsParameters {
  const isTT = frame.category === 'tt'
  const isDiscWheel = !frame.hasFixedWheels && wheelset?.front.category === 'disc'

  // Both legs of the combo need a real solved delta to combine additively -
  // mixing an absolute delta from one leg with a score-derived value from
  // the other would be a unit mismatch. `hasFixedWheels` frames' own
  // measured data already represents the whole frame+wheel unit (see
  // `classifyBikeFrame.ts`'s `FIXED_WHEEL_FRAMES`), so they never need a
  // wheel-side delta at all.
  const wheelPhysics = frame.hasFixedWheels || !wheelset ? undefined : wheelset.physics
  if (frame.physics && (frame.hasFixedWheels || !wheelset || wheelPhysics)) {
    const baselineCdaM2 = isTT ? TT_BASELINE_CDA_M2 : STANDARD_BASELINE_CDA_M2
    const baselineBikeMassKg = isTT ? TT_BASELINE_BIKE_MASS_KG : STANDARD_BASELINE_BIKE_MASS_KG
    return {
      cdaM2: baselineCdaM2 + frame.physics.cdaDeltaM2 + (wheelPhysics?.cdaDeltaM2 ?? 0) + (isTT && isDiscWheel ? TT_DISC_RESIDUAL_CDA_DELTA_M2 : 0),
      bikeMassKg: baselineBikeMassKg + frame.physics.bikeMassDeltaKg + (wheelPhysics?.bikeMassDeltaKg ?? 0)
    }
  }

  // Fallback for frames/wheels without real gap-seconds data.
  const aeroScore = frame.hasFixedWheels || !wheelset
    ? frame.scores.aero
    : (frame.scores.aero + wheelset.scores.aero) / 2
  const climbScore = frame.hasFixedWheels || !wheelset
    ? frame.scores.climb
    : (frame.scores.climb + wheelset.scores.climb) / 2

  return {
    bikeMassKg: bikeMassFromScore(climbScore, isTT),
    cdaM2: equipmentCdaFromScore(aeroScore, isTT, isDiscWheel)
  }
}
