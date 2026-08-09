import type { ClassifiedBikeFrame, Wheelset } from '../../types/catalog'
import type { PhysicsParameters } from '../../types/physics'

const BASE_BIKE_MASS_KG = 8
const CLIMB_MASS_SENSITIVITY = 0.4
const BASE_CDA = 0.32
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

export function cdaFromScore(aeroScore: number, isTT: boolean, isDiscWheel: boolean): number {
  let cda = BASE_CDA
  if (isTT) {
    cda *= TT_CDA_MULTIPLIER
    if (isDiscWheel) cda *= TT_DISC_CDA_MULTIPLIER
  }
  return cda * (1 - normalizeScore(aeroScore) * AERO_SENSITIVITY)
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
    cdaM2: cdaFromScore(aeroScore, isTT, isDiscWheel)
  }
}
