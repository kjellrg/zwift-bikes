import type { RouteWithMeta } from '../../types/catalog'
import type { RouteGeometry, RouteGeometryPoint } from '../../types/physics'
import { geometryFromRoute } from './simulator'

/**
 * Builds compatibility geometry from the aggregate route data available in
 * zwift-data. Route elevation is cumulative elevation GAIN, not the elevation
 * difference between the start and finish. Treating it as endpoint elevation
 * makes every route climb continuously and is a major source of overly slow
 * dynamic predictions on rolling courses.
 *
 * Until measured route elevation profiles are available, represent each lap as
 * a small number of rolling climb/descent sections. The synthetic profile
 * preserves the route's total distance and cumulative ascent while avoiding
 * the physically incorrect assumption that all climbing happens continuously.
 */
function appendRollingLap(
  points: RouteGeometryPoint[],
  startDistanceM: number,
  startElevationM: number,
  lapDistanceM: number,
  lapElevationGainM: number,
  surface: RouteGeometryPoint['surface']
): { distanceM: number; elevationM: number } {
  const sectionCount = 4
  const sectionDistanceM = lapDistanceM / sectionCount
  const climbPerSectionM = lapElevationGainM / 2
  let distanceM = startDistanceM
  let elevationM = startElevationM

  // Two climbs and two descents, with zero net elevation change. This is a
  // deliberately conservative compatibility approximation for aggregate
  // route data; it is much closer to rolling Zwift courses than a continuous
  // average uphill grade.
  const elevationDeltas = [climbPerSectionM, -climbPerSectionM, climbPerSectionM, -climbPerSectionM]
  for (const deltaM of elevationDeltas) {
    distanceM += sectionDistanceM
    elevationM += deltaM
    points.push({ distanceM, elevationM, surface })
  }

  return { distanceM, elevationM }
}

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

  points.push({ distanceM, elevationM, surface: firstSurface })

  if (leadInDistanceM > 0) {
    distanceM += leadInDistanceM
    elevationM += leadInElevationM
    points.push({ distanceM, elevationM, surface: firstSurface })
  }

  for (let lap = 0; lap < lapCount; lap++) {
    const result = appendRollingLap(
      points,
      distanceM,
      elevationM,
      lapDistanceM,
      lapElevationM,
      firstSurface
    )
    distanceM = result.distanceM
    elevationM = result.elevationM
  }

  return {
    routeSlug: route.slug,
    points,
    totalDistanceM: distanceM
  }
}
