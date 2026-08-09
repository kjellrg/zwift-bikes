import type { ClassifiedBikeFrame, Wheelset } from './catalog'

export type PhysicsSurface =
  | 'tarmac'
  | 'brick'
  | 'wood'
  | 'cobbles'
  | 'snow'
  | 'dirt'
  | 'grass'
  | 'sand'
  | 'gravel'

export interface RouteGeometryPoint {
  /** Distance from the start of this geometry in metres. */
  distanceM: number
  /** Elevation at this point in metres. */
  elevationM: number
  /** Surface beginning at this point. */
  surface: PhysicsSurface
}

export interface RouteGeometry {
  routeSlug: string
  points: RouteGeometryPoint[]
  totalDistanceM: number
}

export interface PhysicsRider {
  weightKg: number
  /** Optional height; future CdA calibration can use it without changing the API. */
  heightCm?: number
  /** Sustained power in watts for this simulation. */
  powerW: number
}

export interface PhysicsEquipment {
  frame: ClassifiedBikeFrame
  wheelset?: Wheelset
}

export interface PhysicsParameters {
  /** Zwift-equivalent bike mass, not necessarily real-world component mass. */
  bikeMassKg: number
  /** Combined rider + equipment frontal area times drag coefficient. */
  cdaM2: number
}

export interface PhysicsState {
  distanceM: number
  elevationM: number
  velocityMps: number
  elapsedSec: number
}

export interface PhysicsForces {
  drivingN: number
  gravityN: number
  rollingN: number
  aerodynamicN: number
  netN: number
  accelerationMps2: number
}

export interface PhysicsSimulationResult {
  elapsedSec: number
  distanceM: number
  averageSpeedMps: number
  finalSpeedMps: number
  state: PhysicsState
}
