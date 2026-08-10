import type { ClassifiedBikeFrame, Wheelset } from '../../types/catalog'
import type { PhysicsParameters } from '../../types/physics'

const BASE_BIKE_MASS_KG = 8
const CLIMB_MASS_SENSITIVITY = 0.4
const BASE_EQUIPMENT_CDA = 0.32
const AERO_SENSITIVITY = 0.12
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
 * Estimate rider frontal area from height and mass.
 *
 * The Du Bois equation returns total body surface area, not frontal area.
 * Earlier code treated it as frontal area, producing ~1.7 m² of CdA for an
 * average rider and making the dynamic model dramatically slower than the
 * legacy model. Use an empirical cycling frontal-area fraction of BSA instead.
 */
export function riderFrontalAreaM2(heightCm: number, weightKg: number): number {
  const heightM = Math.max(1, heightCm) / 100
  const mass = Math.max(30, weightKg)
  const bodySurfaceAreaM2 = 0.2025 * Math.pow(heightM, 0.725) * Math.pow(mass, 0.425)
  return bodySurfaceAreaM2 * 0.23
}

export function riderCdaM2(heightCm: number, weightKg: number): number {
  return riderFrontalAreaM2(heightCm, weightKg) * 0.88
}

export function equipmentPhysics(frame: ClassifiedBikeFrame, wheelset?: Wheelset): PhysicsParameters {
  const aeroScore = frame.hasFixedWheels || !wheelset
    ? frame.scores.aero
    : (frame.scores.aero + wheelset.scores.aero) / 2
  const climbScore = frame.hasFixedWheels || !wheelset
    ? frame.scores.climb
    : (frame.scores.climb + wheelset.scores.climb) / 2
  const isTT = frame.category === 'tt'
  const isDiscWheel = !frame.hasFixedWheels && wheelset?.front.category === 'disc'

  return {
    bikeMassKg: bikeMassFromScore(climbScore, isTT),
    cdaM2: equipmentCdaFromScore(aeroScore, isTT, isDiscWheel)
  }
}
