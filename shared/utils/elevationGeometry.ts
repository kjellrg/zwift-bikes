import type { RouteElevationPoint } from '../types/catalog'

/**
 * Perpendicular distance from `point` to the line through `lineStart`/`lineEnd`,
 * treating `distanceM` as x and `elevationM` as y - used by `simplifyProfile`'s
 * Ramer-Douglas-Peucker reduction.
 */
function perpendicularDistanceM(point: RouteElevationPoint, lineStart: RouteElevationPoint, lineEnd: RouteElevationPoint): number {
  const dx = lineEnd.distanceM - lineStart.distanceM
  const dy = lineEnd.elevationM - lineStart.elevationM
  if (dx === 0 && dy === 0) return Math.hypot(point.distanceM - lineStart.distanceM, point.elevationM - lineStart.elevationM)

  const norm = Math.hypot(dx, dy)
  return Math.abs(dy * point.distanceM - dx * point.elevationM + lineEnd.distanceM * lineStart.elevationM - lineEnd.elevationM * lineStart.distanceM) / norm
}

/**
 * Ramer-Douglas-Peucker polyline simplification. A raw Strava altitude
 * stream can have a point every few metres - storing that in full for ~300
 * routes would bloat `routeSurfaces.generated.json` by tens of MB for
 * negligible physics benefit (grade barely changes point-to-point on a
 * straight, flat road). Keeping only points where the profile deviates from
 * a straight line by more than `toleranceM` collapses long straight/flat
 * stretches to a couple of points while preserving real climbs, descents and
 * rollers at full detail - exactly the shape the dynamic physics simulator
 * needs (it already linearly interpolates grade between consecutive points).
 */
function simplifyProfile(points: RouteElevationPoint[], toleranceM: number): RouteElevationPoint[] {
  if (points.length <= 2) return points

  const first = points[0]!
  const last = points[points.length - 1]!
  let maxDistanceM = 0
  let maxIndex = 0
  for (let i = 1; i < points.length - 1; i++) {
    const distanceM = perpendicularDistanceM(points[i]!, first, last)
    if (distanceM > maxDistanceM) {
      maxDistanceM = distanceM
      maxIndex = i
    }
  }

  if (maxDistanceM <= toleranceM) return [first, last]

  const left = simplifyProfile(points.slice(0, maxIndex + 1), toleranceM)
  const right = simplifyProfile(points.slice(maxIndex), toleranceM)
  return [...left.slice(0, -1), ...right]
}

/**
 * Builds a simplified, lap-relative elevation profile from a Strava segment's
 * raw `distance`/`altitude` streams (index-aligned, as returned by Strava's
 * segment streams API). Elevation is normalized to start at `0` (the streams
 * carry absolute altitude, but the physics model only cares about relative
 * gain/loss from the lap start - see `RouteElevationPoint`).
 *
 * `toleranceM` is the max allowed perpendicular deviation (in metres of
 * elevation) a dropped point can represent - 1.5m comfortably preserves real
 * road grade changes while collapsing GPS/barometric noise and long flat
 * stretches. Returns `[]` if the streams are missing, mismatched, or too
 * short to represent a profile.
 */
export function computeElevationProfile(
  distanceStreamM: number[],
  altitudeStreamM: number[],
  toleranceM = 1.5
): RouteElevationPoint[] {
  if (distanceStreamM.length !== altitudeStreamM.length || distanceStreamM.length < 2) return []

  const baseAltitudeM = altitudeStreamM[0]!
  const raw = distanceStreamM.map((distanceM, i) => ({ distanceM, elevationM: altitudeStreamM[i]! - baseAltitudeM }))
  return simplifyProfile(raw, toleranceM)
}
