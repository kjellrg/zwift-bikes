import type { RouteWithMeta } from '../types/catalog'
import type { PhysicsSurface, RouteGeometryPoint, RouteSurfaceSegment } from '../types/physics'
import { geometryForRouteLaps } from './physics/routeGeometry'
import { expandClimbsForLaps, expandSprintsForLaps } from './routeOccurrences'

/**
 * The Silhouette (see `CONTEXT.md`): the one geometry every drawing of a
 * Ride's profile is made from - the Course hero, the Discovery cards, the
 * related-route cards, a season's race rows and the share cards - so a route
 * has one shape wherever it is shown.
 *
 * Everything is in a unit box: `x` runs 0..1 along the ride, `y` 0..1 from
 * its lowest point to its highest. A renderer scales the box to its own
 * size and flips `y` if its axis points down; nothing here knows about
 * pixels, SVG or a Colour mode.
 */

/**
 * The smallest elevation range the box stretches to fill. Under it a
 * profile is drawn to scale inside this span rather than stretched to the
 * top, so a flat crit reads as flat instead of as its metre-level noise
 * blown up into mountains - the same floor the old elevation chart and the
 * old share-card sampler each kept, now kept once.
 */
export const SILHOUETTE_MIN_SPAN_M = 40

/**
 * The three surface families the site draws, and the only three colours a
 * surface ever takes: tarmac in the strong rule, the loose family (dirt,
 * gravel, grass, sand, snow) in dirt ochre, and the hard-but-rough one
 * (cobbles, brick, wood) in grey-blue.
 */
export type SurfaceFamily = 'tarmac' | 'dirt' | 'rough'

const DIRT_FAMILY: ReadonlySet<string> = new Set(['dirt', 'gravel', 'grass', 'sand', 'snow'])
const ROUGH_FAMILY: ReadonlySet<string> = new Set(['cobbles', 'brick', 'wood'])

export function surfaceFamily(surface: PhysicsSurface | string): SurfaceFamily {
  if (DIRT_FAMILY.has(surface)) return 'dirt'
  if (ROUGH_FAMILY.has(surface)) return 'rough'
  return 'tarmac'
}

export interface SilhouettePoint {
  /** Fraction of the ride, 0..1. */
  x: number
  /** Fraction of the drawn height, 0 at the lowest point. */
  y: number
  distanceM: number
  elevationM: number
}

/** A stretch of the ride as fractions of it, `from` < `to`, both inside 0..1. */
export interface SilhouetteSpan {
  from: number
  to: number
}

export interface SilhouetteBand extends SilhouetteSpan {
  name: string
  slug: string
}

export interface SilhouetteSurfaceSpan extends SilhouetteSpan {
  family: SurfaceFamily
}

export interface Silhouette {
  points: SilhouettePoint[]
  /** Named climbs, in ride order. */
  climbs: SilhouetteBand[]
  /** Named sprints, in ride order. */
  sprints: SilhouetteBand[]
  /** Where each surface family begins and ends; empty when the positions are not known. */
  surfaces: SilhouetteSurfaceSpan[]
  totalDistanceM: number
  minElevationM: number
  maxElevationM: number
}

/** A named climb or sprint by its position along the ride, lead-in included - a `SegmentOccurrence`. */
export interface SilhouetteOccurrence {
  name: string
  slug: string
  rideFromKm: number
  rideToKm: number
}

export interface SilhouetteInput {
  /** The ride's shape in ride coordinates, `distanceM` 0 at the start. */
  points: readonly RouteGeometryPoint[]
  surfaceSegments?: readonly RouteSurfaceSegment[]
  climbs?: readonly SilhouetteOccurrence[]
  sprints?: readonly SilhouetteOccurrence[]
}

export interface SilhouetteOptions {
  /**
   * Resample the shape at this many even distances, ends included, instead
   * of keeping every measured point: a card or a share image needs the
   * outline, not the few hundred points a long route's profile carries.
   */
  samples?: number
}

/** Elevation at `distanceM`, linearly interpolated the way the simulator reads grade between points. */
function elevationAt(points: readonly RouteGeometryPoint[], distanceM: number): number {
  let index = 1
  while (index < points.length - 1 && points[index]!.distanceM < distanceM) index++
  const a = points[index - 1]!
  const b = points[index] ?? a
  const span = b.distanceM - a.distanceM
  return span > 0 ? a.elevationM + (b.elevationM - a.elevationM) * ((distanceM - a.distanceM) / span) : b.elevationM
}

function resample(points: readonly RouteGeometryPoint[], samples: number): RouteGeometryPoint[] {
  const totalM = points.at(-1)!.distanceM
  return Array.from({ length: samples }, (_, index) => {
    const distanceM = (index / (samples - 1)) * totalM
    return { distanceM, elevationM: elevationAt(points, distanceM) }
  })
}

const clampFraction = (value: number) => Math.min(1, Math.max(0, value))

function bands(occurrences: readonly SilhouetteOccurrence[] | undefined, totalKm: number): SilhouetteBand[] {
  return (occurrences ?? [])
    .map(item => ({ name: item.name, slug: item.slug, from: clampFraction(item.rideFromKm / totalKm), to: clampFraction(item.rideToKm / totalKm) }))
    .filter(band => band.to > band.from)
}

function surfaceSpans(segments: readonly RouteSurfaceSegment[] | undefined, totalM: number): SilhouetteSurfaceSpan[] {
  const spans: SilhouetteSurfaceSpan[] = []
  for (const segment of segments ?? []) {
    const from = clampFraction(segment.fromM / totalM)
    const to = clampFraction(segment.toM / totalM)
    if (to <= from) continue
    const family = surfaceFamily(segment.surface)
    const previous = spans.at(-1)
    if (previous && previous.family === family && Math.abs(previous.to - from) < 1e-9) previous.to = to
    else spans.push({ from, to, family })
  }
  return spans
}

/** The Silhouette of any shape: the general form, for a caller that already holds geometry. */
export function silhouette(input: SilhouetteInput, options: SilhouetteOptions = {}): Silhouette {
  const source = input.points
  const totalDistanceM = source.at(-1)?.distanceM ?? 0
  const drawn = options.samples && options.samples > 1 && totalDistanceM > 0 ? resample(source, options.samples) : [...source]
  const elevations = drawn.map(point => point.elevationM)
  const minElevationM = elevations.length ? Math.min(...elevations) : 0
  const maxElevationM = elevations.length ? Math.max(...elevations) : 0
  const span = Math.max(maxElevationM - minElevationM, SILHOUETTE_MIN_SPAN_M)
  const totalKm = totalDistanceM / 1000

  return {
    points: drawn.map(point => ({
      x: totalDistanceM > 0 ? point.distanceM / totalDistanceM : 0,
      y: (point.elevationM - minElevationM) / span,
      distanceM: point.distanceM,
      elevationM: point.elevationM
    })),
    climbs: totalKm > 0 ? bands(input.climbs, totalKm) : [],
    sprints: totalKm > 0 ? bands(input.sprints, totalKm) : [],
    surfaces: totalDistanceM > 0 ? surfaceSpans(input.surfaceSegments, totalDistanceM) : [],
    totalDistanceM,
    minElevationM,
    maxElevationM
  }
}

/**
 * A route's (or a segment-as-route's) Silhouette for `laps` laps, the
 * lead-in once: the very geometry the simulator rides (`geometryForRouteLaps`)
 * with its climbs and sprints expanded per lap by the same functions the
 * course tabs use, so the picture, the markers and the finish time describe
 * one ride.
 *
 * Undefined when the route has no measured profile: the geometry builder
 * would otherwise hand back the model's own approximation, and a Silhouette
 * drawn from that would be a shape nobody has ridden. The surface strip
 * follows the same rule - drawn only where the surfaces' positions were
 * measured, never from a mix laid out in share order.
 */
export function routeSilhouette(route: RouteWithMeta, laps = 1, options: SilhouetteOptions = {}): Silhouette | undefined {
  if ((route.terrain.elevationProfile?.length ?? 0) < 2) return undefined
  const geometry = geometryForRouteLaps(route, laps)
  return silhouette({
    points: geometry.points,
    surfaceSegments: route.surface.segments?.length ? geometry.surfaceSegments : undefined,
    climbs: expandClimbsForLaps(route, laps),
    sprints: expandSprintsForLaps(route, laps)
  }, options)
}
