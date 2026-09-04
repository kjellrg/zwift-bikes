import type { RouteElevationPoint, SurfaceSegment } from '../types/catalog'

/**
 * Maps a route's measured GPS trace onto its official length.
 *
 * Every measured route carries two position-tagged arrays derived from one
 * community Strava trace: `SurfaceEstimate.segments` (where each surface
 * starts and ends) and `TerrainProfile.elevationProfile` (the shape of the
 * road). Both are in TRACE km, and a community trace is never exactly the
 * official route distance - GPS noise, a start banner crossed a few metres
 * early, an extra half-lap of run-out. Across the catalog the disagreement
 * is under 1% on most routes but reaches 8.3% (valley-to-mountaintop), 6.9%
 * (macaron), 6.1% (makuri-madness) and 4.6% (three-sisters-rev).
 *
 * Before issue #171 the two arrays handled that disagreement DIFFERENTLY:
 * the elevation profile was stretched onto the official distance by
 * `appendMeasuredLap`, while the surface segments were merely clipped to it.
 * The two then described different roads - three-sisters-rev lost the last
 * 2.1 km of its measured surface entirely, and valley-to-mountaintop's
 * cobbles sat 8% further along the course than the climb they are actually
 * on. Worse, a trace SHORTER than official left a trailing stretch with no
 * segment at all, and the simulator's surface lookup answers such a gap with
 * the NEXT segment - on a multi-lap ride, the next lap's opening surface.
 *
 * The fix is to rescale both, once, with the same factor, as the measured
 * data enters the domain model (`estimateSurface` and `computeTerrain` in
 * `routeTerrain.ts`). Everything downstream - the simulator, the per-segment
 * slicing in `routeSegments.ts`, the route page's surface/speed chart - then
 * reads one consistent set of official-km positions, and `appendMeasuredLap`'s
 * own rescale becomes the no-op it should always have been.
 *
 * Percentages are unaffected: a uniform scale changes no surface's share of
 * the lap, so `composition` (and the finish-time blend built from it) stays
 * exactly as generated.
 */

/**
 * How far a trace may disagree with the official distance before rescaling
 * it is more likely to be wrong than right. Inside this band the trace is
 * the same road measured imperfectly; outside it, the Strava segment is
 * something else entirely (a different route, a partial ride) and stretching
 * it would invent surface positions rather than correct them - such an entry
 * is left as-is, clipped, and `compute-route-surfaces.mjs` reports it.
 */
const MAX_TRACE_SCALE = 1.25
const MIN_TRACE_SCALE = 0.8

/** Distance below which a "route" is too short to talk about a scale - guards the division only. */
const MIN_TRACE_KM = 0.001

/**
 * The factor that maps trace km onto official km, or `1` when there is
 * nothing trustworthy to scale by.
 */
export function measuredTraceScale(traceKm: number | undefined, officialKm: number | undefined): number {
  if (!traceKm || !officialKm || traceKm < MIN_TRACE_KM || officialKm < MIN_TRACE_KM) return 1
  const scale = officialKm / traceKm
  if (scale < MIN_TRACE_SCALE || scale > MAX_TRACE_SCALE) return 1
  return scale
}

/**
 * Rescales trace-relative surface segments onto `officialKm`, so the last
 * one ends exactly on the official distance. Segments are contiguous from
 * `0` by construction (`computeSurfaceProfile` merges consecutive points, and
 * `normalize.mjs` re-bases the split halves), so scaling every boundary keeps
 * them contiguous and leaves no gap for the simulator's surface lookup to
 * fall into.
 */
export function rescaleSurfaceSegments(segments: SurfaceSegment[] | undefined, officialKm: number | undefined): SurfaceSegment[] | undefined {
  if (!segments?.length) return segments
  const scale = measuredTraceScale(segments[segments.length - 1]!.toKm, officialKm)
  if (scale === 1) return segments
  return segments.map(segment => ({ ...segment, fromKm: segment.fromKm * scale, toKm: segment.toKm * scale }))
}

/**
 * The same rescale for an elevation profile. Distances move; elevations do
 * not - the measured climb is a real 200 m whether the trace called the road
 * 4.59 km or 5.01 km, and stretching the metres would change every grade on
 * the route. This is exactly what `appendMeasuredLap` has always done to the
 * profile at geometry-build time; doing it here as well is what puts the
 * surface segments in the same coordinates.
 */
export function rescaleElevationProfile(profile: RouteElevationPoint[] | undefined, officialKm: number | undefined): RouteElevationPoint[] | undefined {
  if (!profile?.length) return profile
  const scale = measuredTraceScale(profile[profile.length - 1]!.distanceM / 1000, officialKm)
  if (scale === 1) return profile
  return profile.map(point => ({ ...point, distanceM: point.distanceM * scale }))
}
