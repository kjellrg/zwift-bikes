import type { WorldSlug } from 'zwift-data'
import type { SurfaceComposition, SurfaceEstimate, SurfaceSegment, ZwiftSurfaceType } from '../types/catalog'
import type { PhysicsSurface, RouteSurfaceSegment } from '../types/physics'
import { getWorldSurfacePolygons, type WorldSurfacePolygon } from '../data/zwiftmapSurfacePolygons'

/**
 * Standard ray-casting point-in-polygon test (even-odd rule). `point` and
 * each `polygon` vertex are `[lat, lng]`. Ported from zwiftmap's use of
 * `@turf/boolean-point-in-polygon` - ray casting gives the same result for
 * these simple (non-self-intersecting) polygons without adding a
 * geo/turf dependency for one small check.
 */
function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [pLat, pLng] = point
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [iLat, iLng] = polygon[i]!
    const [jLat, jLng] = polygon[j]!
    const straddles = (iLng > pLng) !== (jLng > pLng)
    if (straddles && pLat < ((jLat - iLat) * (pLng - iLng)) / (jLng - iLng) + iLat) inside = !inside
  }
  return inside
}

function surfaceAt(point: [number, number], polygons: WorldSurfacePolygon[]): ZwiftSurfaceType {
  for (const { type, polygon } of polygons) {
    if (isPointInPolygon(point, polygon)) return type
  }
  return 'tarmac'
}

export interface SurfaceProfile {
  /** Aggregate % per surface type - for display and for the legacy (blended-Crr) finish-time model. */
  composition: SurfaceComposition
  /** Ordered, position-tagged surface stretches - lets the dynamic physics model use the real surface at each point instead of one blended/dominant value for the whole route. */
  segments: SurfaceSegment[]
}

/**
 * Real per-route surface profile, computed the same way zwiftmap's
 * `getSurfaceStream`/`getSurfaceStats` do: classify each point of a route's
 * real GPS trace against the hand-mapped world surface polygons (defaulting
 * to tarmac where no polygon matches). Unlike zwiftmap, this keeps *where*
 * each surface occurs (merging consecutive same-type points into segments),
 * not just the aggregate per-type totals - a route's GPS trace can have many
 * points but typically only a handful of surface transitions.
 *
 * `latLngStream`/`distanceStreamM` must be the same length and index-aligned
 * (as returned by Strava's segment streams API - `distanceStreamM` is
 * cumulative distance from the segment start, in metres).
 */
export function computeSurfaceProfile(
  world: WorldSlug,
  latLngStream: [number, number][],
  distanceStreamM: number[]
): SurfaceProfile {
  const polygons = getWorldSurfacePolygons(world)
  const totalsM: Partial<Record<ZwiftSurfaceType, number>> = {}
  const segments: SurfaceSegment[] = []
  let currentType: ZwiftSurfaceType | undefined
  let currentFromM = 0

  const pointCount = Math.min(latLngStream.length, distanceStreamM.length)
  for (let i = 1; i < pointCount; i++) {
    const previousDistanceM = distanceStreamM[i - 1]!
    const deltaM = distanceStreamM[i]! - previousDistanceM
    if (deltaM <= 0) continue

    const type = surfaceAt(latLngStream[i]!, polygons)
    totalsM[type] = (totalsM[type] ?? 0) + deltaM

    if (type !== currentType) {
      if (currentType !== undefined) segments.push({ fromKm: currentFromM / 1000, toKm: previousDistanceM / 1000, type: currentType })
      currentType = type
      currentFromM = previousDistanceM
    }
  }
  if (currentType !== undefined) {
    segments.push({ fromKm: currentFromM / 1000, toKm: (distanceStreamM[pointCount - 1] ?? currentFromM) / 1000, type: currentType })
  }

  const totalM = Object.values(totalsM).reduce((sum, m) => sum + (m ?? 0), 0)
  const composition = totalM <= 0
    ? { tarmac: 100 }
    : Object.fromEntries(Object.entries(totalsM).map(([type, m]) => [type, ((m ?? 0) / totalM) * 100]))

  return { composition, segments }
}

/**
 * Clips a lap's measured, position-tagged surface segments (`SurfaceSegment[]`,
 * km-relative to the lap start) to `[fromKm, toKm)`, offsetting the result to
 * start at `offsetM` metres - shared by `physics/routeGeometry.ts`'s
 * `lapSurfaceSegments` (clipping to a whole lap, `fromKm=0`) and
 * `routeSegments.ts` (clipping to a single climb/sprint's own km range).
 * Falls back to one segment spanning the whole range when there's no
 * measured data (or it doesn't reach this far) - the same "one surface for
 * everything" approximation used elsewhere when real data is unavailable.
 */
export function sliceSurfaceSegments(
  measured: SurfaceSegment[] | undefined,
  fromKm: number,
  toKm: number,
  fallbackSurface: PhysicsSurface,
  offsetM = 0
): RouteSurfaceSegment[] {
  const spanM = Math.max(0, (toKm - fromKm) * 1000)
  if (!measured || measured.length === 0) {
    return [{ fromM: offsetM, toM: offsetM + spanM, surface: fallbackSurface }]
  }

  const fromM = fromKm * 1000
  const sliced = measured
    .map(segment => ({
      fromM: offsetM + Math.max(0, segment.fromKm * 1000 - fromM),
      toM: offsetM + Math.min(spanM, segment.toKm * 1000 - fromM),
      surface: segment.type as PhysicsSurface
    }))
    .filter(segment => segment.toM > segment.fromM)

  return sliced.length > 0 ? sliced : [{ fromM: offsetM, toM: offsetM + spanM, surface: fallbackSurface }]
}

/** Turns a sliced/position-tagged surface segment list back into aggregate percentages, e.g. for a single climb/sprint's own `SurfaceComposition`. */
export function surfaceCompositionFromSegments(segments: RouteSurfaceSegment[]): SurfaceComposition {
  const totalsM: Partial<Record<PhysicsSurface, number>> = {}
  for (const segment of segments) {
    const lengthM = segment.toM - segment.fromM
    if (lengthM <= 0) continue
    totalsM[segment.surface] = (totalsM[segment.surface] ?? 0) + lengthM
  }
  const totalM = Object.values(totalsM).reduce((sum, m) => sum + (m ?? 0), 0)
  if (totalM <= 0) return { tarmac: 100 }
  return Object.fromEntries(Object.entries(totalsM).map(([type, m]) => [type, ((m ?? 0) / totalM) * 100]))
}

/**
 * The surface an UNMEASURED lead-in is ridden on, or `undefined` when the
 * lead-in should inherit the lap's own surface data.
 *
 * The lead-in is not the lap: it runs from the start pen, and every pen in
 * the game sits on tarmac - except in a world whose ground is one surface
 * end to end (Paris is 100% cobbles, pens included). Only the routes whose
 * Strava trace covered the pen-to-lap run carry `leadInSegments`; for the
 * rest, borrowing the lap's dominant surface priced Jungle Circuit's 5.7 km
 * paved descent to the jungle as 95% dirt (Serpentine 8's 7.5 km lead-in
 * likewise) - up to two minutes of phantom rolling loss on road wheels,
 * one-sided, on exactly the routes where wheel Crr decides the ranking.
 *
 * "One surface end to end" is read off the lap composition rather than the
 * world slug so a future single-surface world needs no code change, and so
 * a mixed lap in a mostly-dirt world (Mayan Bridge Loop: dirt, brick, wood)
 * still gets its paved pen. Shared by `geometryForRouteLaps` (simulator)
 * and `estimateFinishTimeSec`'s `leadInCrr` (ranking key) so the two never
 * disagree about a lead-in.
 */
export function unmeasuredLeadInSurface(surface: SurfaceEstimate): PhysicsSurface | undefined {
  if (surface.leadInSegments) return undefined
  const present = Object.entries(surface.composition ?? {}).filter(([, percent]) => (percent ?? 0) > 0)
  if (present.length === 1 && present[0]![0] !== 'tarmac') return undefined
  return 'tarmac'
}
