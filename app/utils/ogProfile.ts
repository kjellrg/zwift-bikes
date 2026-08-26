import type { RouteGeometryPoint } from '#shared/types/physics'

/**
 * Elevation silhouette for a share card: elevations sampled at even
 * distances across the given geometry points, normalized to 0..1 of the
 * ride's own height range. A 30 m floor on that range keeps genuinely flat
 * rides (crit circuits, flat sprints) reading as flat instead of amplifying
 * meter-level noise to full card height.
 *
 * Route pages feed it `geometryForRouteLaps(route, 1).points` (lead-in + one
 * lap); segment pages feed it `geometryForSegment(...)` built from the
 * segment's measured profile slice.
 */
export function ogProfileFromPoints(points: RouteGeometryPoint[]): number[] {
  const totalM = points[points.length - 1]?.distanceM ?? 0
  if (totalM <= 0) return []
  const samples = 120
  const values: number[] = []
  let j = 0
  for (let i = 0; i < samples; i++) {
    const d = (i / (samples - 1)) * totalM
    while (j < points.length - 2 && points[j + 1]!.distanceM < d) j++
    const a = points[j]!
    const b = points[j + 1] ?? a
    const t = b.distanceM > a.distanceM ? (d - a.distanceM) / (b.distanceM - a.distanceM) : 0
    values.push(a.elevationM + (b.elevationM - a.elevationM) * t)
  }
  const min = Math.min(...values)
  const range = Math.max(Math.max(...values) - min, 30)
  return values.map(v => Math.round(((v - min) / range) * 100) / 100)
}
