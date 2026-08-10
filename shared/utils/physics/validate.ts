import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from '../../types/catalog'
import type { PhysicsRider } from '../../types/physics'
import { geometryFromRoute, simulateRoute } from './simulator'

export interface PhysicsComparison {
  legacyFinishTimeSec: number
  dynamicFinishTimeSec: number
  deltaSec: number
  deltaPercent: number
}

/**
 * Compare the new integrator with the legacy estimate. This is intentionally
 * a small diagnostic helper rather than an assertion that either model is
 * correct; real route geometry is required before the dynamic model can be
 * treated as a Zwift-calibrated result.
 */
export function comparePhysicsModels(
  route: RouteWithMeta,
  frame: ClassifiedBikeFrame,
  wheelset: Wheelset | undefined,
  rider: PhysicsRider,
  legacyFinishTimeSec: number
): PhysicsComparison {
  const dynamic = simulateRoute({
    rider,
    frame,
    wheelset,
    geometry: geometryFromRoute(route)
  })
  const deltaSec = dynamic.elapsedSec - legacyFinishTimeSec
  return {
    legacyFinishTimeSec,
    dynamicFinishTimeSec: dynamic.elapsedSec,
    deltaSec,
    deltaPercent: legacyFinishTimeSec > 0 ? (deltaSec / legacyFinishTimeSec) * 100 : 0
  }
}
