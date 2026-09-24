import type { RouteWithMeta } from '../types/catalog'
import type { PhysicsSurface, RouteGeometryPoint, RouteSurfaceSegment } from '../types/physics'
import { geometryForRouteLaps } from './physics/routeGeometry'
import { expandClimbsForLaps, expandSprintsForLaps } from './routeOccurrences'

/**
 * The one geometry every drawing of a Ride's profile is made from, in two
 * sizes, so a route has one shape wherever it is shown:
 *
 * - the `CourseProfile`, the Course hero's geometry - every measured point
 *   with its distance and elevation, the named climbs and sprints, the
 *   surfaces by name and the totals;
 * - the **Silhouette** (see `CONTEXT.md`), the small outline every listing
 *   draws - Discovery cards, related rides, a season's race rows - and the
 *   share cards: heights alone at even distances, the surfaces by family,
 *   and nothing a pointer could read off.
 *
 * Both are in a unit box: `x` runs 0..1 along the ride, `y` 0..1 from its
 * lowest point to its highest. A renderer scales the box to its own size and
 * flips `y` if its axis points down; nothing here knows about pixels, SVG or
 * a Colour mode.
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

export interface CourseProfilePoint {
  /** Fraction of the ride, 0..1. */
  x: number
  /** Fraction of the drawn height, 0 at the lowest point. */
  y: number
  distanceM: number
  elevationM: number
}

/** A stretch of the ride as fractions of it, `from` < `to`, both inside 0..1. */
export interface CourseProfileSpan {
  from: number
  to: number
}

export interface CourseProfileBand extends CourseProfileSpan {
  name: string
  slug: string
}

export interface CourseProfileSurfaceSpan extends CourseProfileSpan {
  /** The surface itself, for a readout that names it. */
  surface: PhysicsSurface
  /** Its family, which is all a drawing colours by. */
  family: SurfaceFamily
}

export interface CourseProfile {
  points: CourseProfilePoint[]
  /** Named climbs, in ride order. */
  climbs: CourseProfileBand[]
  /** Named sprints, in ride order. */
  sprints: CourseProfileBand[]
  /** Where each surface begins and ends, in ride order; empty when the positions are not known. */
  surfaces: CourseProfileSurfaceSpan[]
  totalDistanceM: number
  minElevationM: number
  maxElevationM: number
  /**
   * Where the drawing stops being the model's approximation, as a fraction:
   * an unmeasured lead-in runs from 0 to here, and a renderer dashes it
   * (`outlineRuns`). Absent when every metre drawn was measured - the laps
   * always are.
   */
  approximatedUntil?: number
}

/** A named climb or sprint by its position along the ride, lead-in included - a `SegmentOccurrence`. */
export interface CourseProfileOccurrence {
  name: string
  slug: string
  rideFromKm: number
  rideToKm: number
}

export interface CourseProfileInput {
  /** The ride's shape in ride coordinates, `distanceM` 0 at the start. */
  points: readonly RouteGeometryPoint[]
  surfaceSegments?: readonly RouteSurfaceSegment[]
  climbs?: readonly CourseProfileOccurrence[]
  sprints?: readonly CourseProfileOccurrence[]
  /** Where an approximated opening stretch ends, in metres from the start - see `CourseProfile.approximatedUntil`. */
  approximatedUntilM?: number
}

export interface CourseProfileOptions {
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

function bands(occurrences: readonly CourseProfileOccurrence[] | undefined, totalKm: number): CourseProfileBand[] {
  return (occurrences ?? [])
    .map(item => ({ name: item.name, slug: item.slug, from: clampFraction(item.rideFromKm / totalKm), to: clampFraction(item.rideToKm / totalKm) }))
    .filter(band => band.to > band.from)
}

function surfaceSpans(segments: readonly RouteSurfaceSegment[] | undefined, totalM: number): CourseProfileSurfaceSpan[] {
  const spans: CourseProfileSurfaceSpan[] = []
  for (const segment of segments ?? []) {
    const from = clampFraction(segment.fromM / totalM)
    const to = clampFraction(segment.toM / totalM)
    if (to <= from) continue
    const previous = spans.at(-1)
    if (previous && previous.surface === segment.surface && Math.abs(previous.to - from) < 1e-9) previous.to = to
    else spans.push({ from, to, surface: segment.surface, family: surfaceFamily(segment.surface) })
  }
  return spans
}

/** The CourseProfile of any shape: the general form, for a caller that already holds geometry. */
export function courseProfile(input: CourseProfileInput, options: CourseProfileOptions = {}): CourseProfile {
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
    maxElevationM,
    // Spread rather than set to `undefined`: the key rides in page payloads.
    ...(input.approximatedUntilM && totalDistanceM > 0 ? { approximatedUntil: clampFraction(input.approximatedUntilM / totalDistanceM) } : {})
  }
}

/** A point of an outline, in the unit box. */
export interface OutlinePoint {
  x: number
  y: number
}

/**
 * An outline split where its approximated opening stretch ends, for a
 * renderer that dashes that stretch: the approximated run first, then the
 * measured one, meeting at a shared point so the line is unbroken. One run,
 * measured, when nothing was approximated.
 */
export function outlineRuns(points: readonly OutlinePoint[], approximatedUntil: number | undefined): { points: OutlinePoint[], approximated: boolean }[] {
  if (!approximatedUntil) return [{ points: [...points], approximated: false }]
  const approximated: OutlinePoint[] = []
  const measured: OutlinePoint[] = []
  for (const [index, point] of points.entries()) {
    if (point.x < approximatedUntil) {
      approximated.push(point)
      continue
    }
    const previous = points[index - 1]
    if (!measured.length && point.x === approximatedUntil) {
      approximated.push(point)
    } else if (!measured.length && previous) {
      const t = (approximatedUntil - previous.x) / (point.x - previous.x)
      const joint = { x: approximatedUntil, y: previous.y + (point.y - previous.y) * t }
      approximated.push(joint)
      measured.push(joint)
    }
    measured.push(point)
  }
  return [{ points: approximated, approximated: true }, { points: measured, approximated: false }]
    .filter(run => run.points.length > 1)
}

/**
 * What a profile is drawn from: a whole route, or the listing's summary of
 * one (`RouteSummary`), which carries the terrain and surfaces but not the
 * lead-in - a card's Silhouette is then the lap alone, which is what a
 * listing describes.
 */
export type CourseProfileRoute = Pick<RouteWithMeta, 'slug' | 'distance' | 'elevation' | 'terrain' | 'surface'>
  & Partial<Pick<RouteWithMeta, 'leadInDistance' | 'leadInElevation'>>

/**
 * A route's (or a segment-as-route's) CourseProfile for `laps` laps, the
 * lead-in once: the very geometry the simulator rides (`geometryForRouteLaps`)
 * with its climbs and sprints expanded per lap by the same functions the
 * course tabs use, so the picture, the markers and the finish time describe
 * one ride.
 *
 * Undefined when the lap has no measured profile: the geometry builder
 * would otherwise hand back the model's own approximation, and a profile
 * drawn from that would be a shape nobody has ridden. A lead-in is often
 * unmeasured on a route whose lap is; it is ridden, so it is drawn, from the
 * builder's approximation (a straight line, or its known climbs), and
 * `approximatedUntil` marks it so every renderer dashes it. The surface
 * strip is drawn only where the lap's surfaces were measured, never from a
 * mix laid out in share order; an unmeasured lead-in takes the builder's
 * surfaces with its shape.
 *
 * A listing's summary has no lead-in, so its Silhouette is the lap alone,
 * and a climb or sprint ridden only in the lead-in has no place on it.
 */
export function routeCourseProfile(route: CourseProfileRoute, laps = 1, options: CourseProfileOptions = {}): CourseProfile | undefined {
  if ((route.terrain.elevationProfile?.length ?? 0) < 2) return undefined
  // Every field the geometry builder reads is on a `CourseProfileRoute`; the
  // lead-in ones it treats as absent when they are.
  const full = route as RouteWithMeta
  const geometry = geometryForRouteLaps(full, laps)
  const leadInM = (route.leadInDistance ?? 0) * 1000
  const onDrawnRide = (occurrence: { perLap: boolean }) => occurrence.perLap || leadInM > 0
  const leadInMeasured = (route.terrain.leadInElevationProfile?.length ?? 0) > 1
  return courseProfile({
    points: geometry.points,
    surfaceSegments: route.surface.segments?.length ? geometry.surfaceSegments : undefined,
    climbs: expandClimbsForLaps(full, laps).filter(onDrawnRide),
    sprints: expandSprintsForLaps(full, laps).filter(onDrawnRide),
    approximatedUntilM: leadInM > 0 && !leadInMeasured ? leadInM : undefined
  }, options)
}

/** Where a Silhouette's surfaces run, by family - all a small drawing colours by. */
export interface SilhouetteSurface extends CourseProfileSpan {
  family: SurfaceFamily
}

/**
 * The small outline every listing draws, and the share cards at a larger
 * size: a CourseProfile resampled at even distances and cut down to what a
 * drawing with no readout needs. `x` is implied - the i-th height is at
 * `i / (heights.length - 1)` of the ride, see `silhouetteOutline` - so a
 * card carries only its heights, as integers 0..`SILHOUETTE_HEIGHT_SCALE`
 * of the box. Spans and
 * `approximatedUntil` are fractions of the ride, to three places.
 */
export interface Silhouette {
  heights: number[]
  /** The surface strip, by family; empty when the positions are not known. */
  surfaces: SilhouetteSurface[]
  /** Where an unmeasured lead-in ends - see `CourseProfile.approximatedUntil`; dashed. */
  approximatedUntil?: number
}

/**
 * Heights per listed Silhouette: homepage cards, related routes and season
 * rows. A larger drawing of the same Ride (a share card, the homepage's
 * example) asks `routeSilhouette` for more.
 */
export const SILHOUETTE_LISTING_SAMPLES = 48

/**
 * About half a pixel on a 200-wide card: a surface span narrower than this
 * cannot be seen on a listing, so it is merged into its neighbour rather
 * than carried in every payload.
 */
export const SILHOUETTE_MIN_SURFACE_SPAN = 0.0025

/** A Silhouette's height at the top of its box: heights are whole numbers, 0 to this. */
export const SILHOUETTE_HEIGHT_SCALE = 1000

/** Spans and the approximated stretch are kept to three places, a tenth of a pixel on a card. */
const toThousandths = (fraction: number) => Math.round(fraction * 1000) / 1000

function silhouetteSurfaces(spans: readonly CourseProfileSurfaceSpan[]): SilhouetteSurface[] {
  const merged: SilhouetteSurface[] = []
  for (const span of spans) {
    const from = toThousandths(span.from)
    const to = toThousandths(span.to)
    const previous = merged.at(-1)
    if (previous && (previous.family === span.family || to - from < SILHOUETTE_MIN_SURFACE_SPAN)) previous.to = to
    else merged.push({ from, to, family: span.family })
  }
  // A narrow opening span has nothing before it to join, so the next takes its stretch.
  const [first, second] = merged
  if (first && second && first.to - first.from < SILHOUETTE_MIN_SURFACE_SPAN) {
    second.from = first.from
    merged.shift()
  }
  return merged
}

/**
 * A route's Silhouette for `laps` laps, the lead-in once: the CourseProfile
 * (`routeCourseProfile`) resampled at `samples` even distances and cut down
 * to heights, family spans and the approximated stretch. Undefined when the
 * lap has no measured profile, like the CourseProfile.
 */
export function routeSilhouette(route: CourseProfileRoute, laps = 1, samples = SILHOUETTE_LISTING_SAMPLES): Silhouette | undefined {
  const profile = routeCourseProfile(route, laps, { samples })
  if (!profile) return undefined
  return {
    heights: profile.points.map(point => Math.round(point.y * SILHOUETTE_HEIGHT_SCALE)),
    surfaces: silhouetteSurfaces(profile.surfaces),
    // Spread rather than set to `undefined`: the key rides in page payloads.
    ...(profile.approximatedUntil ? { approximatedUntil: toThousandths(profile.approximatedUntil) } : {})
  }
}

/** A Silhouette's outline in the unit box, each height at its even place along the ride. */
export function silhouetteOutline(shape: Silhouette): OutlinePoint[] {
  const last = Math.max(1, shape.heights.length - 1)
  return shape.heights.map((height, index) => ({ x: index / last, y: height / SILHOUETTE_HEIGHT_SCALE }))
}
