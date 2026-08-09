import type { PhysicsForces, PhysicsRider, PhysicsParameters, PhysicsSurface } from '../../types/physics'
import { SURFACE_CRR } from '../../data/surfaceCrr'

export const GRAVITY = 9.80665
export const AIR_DENSITY = 1.225
export const DRIVETRAIN_EFFICIENCY = 0.975
const STARTUP_SPEED_MPS = 0.1

export function rollingResistanceCoefficient(
  surface: PhysicsSurface,
  crrClass: 'road' | 'gravel' | 'mountain'
): number {
  return SURFACE_CRR[surface][crrClass] ?? SURFACE_CRR.grass.mountain ?? 0.042
}

export function calculateForces(
  velocityMps: number,
  grade: number,
  rider: PhysicsRider,
  parameters: PhysicsParameters,
  surface: PhysicsSurface,
  crrClass: 'road' | 'gravel' | 'mountain'
): PhysicsForces {
  const totalMassKg = rider.weightKg + parameters.bikeMassKg
  const theta = Math.atan(grade)
  const cosTheta = Math.cos(theta)
  const sinTheta = Math.sin(theta)
  const speed = Math.max(0, velocityMps)
  const crr = rollingResistanceCoefficient(surface, crrClass)

  // Power/speed becomes singular at zero speed. Use a small startup speed so
  // a rider with positive power can accelerate away from rest, while retaining
  // the normal P/v relationship once the bike is moving.
  const effectiveSpeed = Math.max(speed, STARTUP_SPEED_MPS)
  const drivingN = rider.powerW > 0
    ? rider.powerW * DRIVETRAIN_EFFICIENCY / effectiveSpeed
    : 0
  const gravityN = totalMassKg * GRAVITY * sinTheta
  const rollingN = crr * totalMassKg * GRAVITY * cosTheta
  const aerodynamicN = 0.5 * AIR_DENSITY * parameters.cdaM2 * speed * speed
  const netN = drivingN - gravityN - rollingN - aerodynamicN

  return {
    drivingN,
    gravityN,
    rollingN,
    aerodynamicN,
    netN,
    accelerationMps2: netN / totalMassKg
  }
}
