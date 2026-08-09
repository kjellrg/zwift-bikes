import type { RouteWithMeta, Wheelset } from '../../types/catalog'
import type { PhysicsEquipment, PhysicsRider, PhysicsSimulationResult, PhysicsState, RouteGeometry } from '../../types/physics'
import { calculateForces } from './forces'
import { equipmentPhysics, riderCdaM2 } from './equipment'

export interface SimulateRouteOptions {
  rider: PhysicsRider
  frame: PhysicsEquipment['frame']
  wheelset?: Wheelset
  geometry: RouteGeometry
  dtSec?: number
  initialSpeedMps?: number
}

function segmentAt(geometry: RouteGeometry, distanceM: number) {
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
  return { grade: distanceDelta > 0 ? elevationDelta / distanceDelta : 0, surface: a.surface }
}

export function simulateRoute(options: SimulateRouteOptions): PhysicsSimulationResult {
  const dt = options.dtSec ?? 0.1
  if (dt <= 0) throw new Error('dtSec must be positive')
  if (options.geometry.points.length < 2) throw new Error('Route geometry requires at least two points')

  const equipment = equipmentPhysics(options.frame, options.wheelset)
  const riderCda = riderCdaM2(options.rider.heightCm ?? 183, options.rider.weightKg)
  const physicsEquipment = { ...equipment, cdaM2: riderCda * (equipment.cdaM2 / 0.32) }
  const crrClass = options.wheelset?.crrClass ?? 'road'
  const state: PhysicsState = {
    distanceM: 0,
    elevationM: options.geometry.points[0]?.elevationM ?? 0,
    velocityMps: Math.max(0, options.initialSpeedMps ?? 0),
    elapsedSec: 0
  }

  const maxSteps = Math.ceil(options.geometry.totalDistanceM / Math.max(0.01, state.velocityMps || 0.1) / dt) * 100 + 10000
  let steps = 0
  while (state.distanceM < options.geometry.totalDistanceM && steps++ < maxSteps) {
    const segment = segmentAt(options.geometry, state.distanceM)
    if (!segment) break
    const forces = calculateForces(state.velocityMps, segment.grade, options.rider, physicsEquipment, segment.surface, crrClass)
    const previousDistance = state.distanceM
    state.velocityMps = Math.max(0, state.velocityMps + forces.accelerationMps2 * dt)
    state.distanceM += state.velocityMps * dt
    if (state.distanceM > options.geometry.totalDistanceM) state.distanceM = options.geometry.totalDistanceM
    const distanceAdvanced = state.distanceM - previousDistance
    state.elevationM += segment.grade * distanceAdvanced
    state.elapsedSec += dt
    if (distanceAdvanced <= 0 && state.velocityMps <= 0 && options.rider.powerW <= 0) break
  }

  return {
    elapsedSec: state.elapsedSec,
    distanceM: state.distanceM,
    averageSpeedMps: state.elapsedSec > 0 ? state.distanceM / state.elapsedSec : 0,
    finalSpeedMps: state.velocityMps,
    state
  }
}

export function geometryFromRoute(route: RouteWithMeta): RouteGeometry {
  const totalDistanceM = route.distance * 1000
  const totalElevationM = route.elevation
  const surface = route.surface.composition
    ? Object.entries(route.surface.composition).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0]
    : undefined
  return {
    routeSlug: route.slug,
    totalDistanceM,
    points: [
      { distanceM: 0, elevationM: 0, surface: surface as RouteGeometry['points'][number]['surface'] ?? 'tarmac' },
      { distanceM: totalDistanceM, elevationM: totalElevationM, surface: surface as RouteGeometry['points'][number]['surface'] ?? 'tarmac' }
    ]
  }
}
