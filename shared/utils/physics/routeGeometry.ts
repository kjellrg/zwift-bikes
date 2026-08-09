import type { RouteWithMeta } from '../../types/catalog'
import type { RouteGeometry, RouteGeometryPoint } from '../../types/physics'
import { geometryFromRoute } from './simulator'

/**
 * Expands the current aggregate route data into the geometry consumed by the
 * simulator. This is still a coarse compatibility geometry: each lap has a
 * start/end point with the route's aggregate elevation, and the lead-in is
 * represented separately when present.
 */
export function geometryForRouteLaps(route: RouteWithMeta, laps: number): RouteGeometry {
  const base = geometryFromRoute(route)
  const lapCount = Math.max(1, Math.floor(laps))
  const leadInDistanceM = (route.leadInDistance ?? 0) * 1000
  const leadInElevationM = route.leadInElevation ?? 0
  const lapDistanceM = route.distance * 1000
  const lapElevationM = route.elevation
  const firstSurface = base.points[0]?.surface ?? 'tarmac'
  const points: RouteGeometryPoint[] = []
  let distanceM = 0
  let elevationM = 0

  if (leadInDistanceM > 0) {
    points.push({ distanceM, elevationM, surface: firstSurface })
    distanceM += leadInDistanceM
    elevationM += leadInElevationM
    points.push({ distanceM, elevationM, surface: firstSurface })
  } else {
    points.push({ distanceM, elevationM, surface: firstSurface })
  }

  for (let lap = 0; lap < lapCount; lap++) {
    distanceM += lapDistanceM
    elevationM += lapElevationM
    points.push({ distanceM, elevationM, surface: firstSurface })
  }

  return {
    routeSlug: route.slug,
    points,
    totalDistanceM: distanceM
  }
}
