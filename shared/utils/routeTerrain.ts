import type { Route } from 'zwift-data'
import type { RouteClimb, SurfaceComposition, SurfaceEstimate, TerrainCategory, TerrainProfile, TerrainWeights } from '../types/catalog'
import { getWorldSurfaceZones } from '../data/zwiftmapSurfaceZones'
import { coarsenSurfaceComposition, normalizeSurfaceComposition } from '../data/surfaceCrr'
import { getGeneratedRouteSurface } from '../data/routeSurfaces'
import { getRouteClimbs, getRouteSprints } from './routeClimbs'
import { measuredTraceScale, rescaleElevationProfile, rescaleSurfaceSegments } from './traceScale'

/**
 * `zwift-data` doesn't expose surface composition (road/gravel/cobbles) for
 * routes. This module:
 *
 * 1. Uses `routeSurfaces.ts`'s generated data where available - real
 *    per-route composition computed from each route's actual GPS trace, the
 *    same way zwiftmap.com does it (see `scripts/route-surfaces/`).
 * 2. Falls back to a curated table (`CURATED_SURFACE`) for a gravel/cobble
 *    route not yet covered by generated data (approximate percentages, based
 *    on public route descriptions) - empty since #324, kept for the next one.
 * 3. For everything else, checks `zwiftmapSurfaceZones` (community-mapped
 *    surface data adapted from zwiftmap, MIT licensed - see
 *    /THIRD_PARTY_NOTICES.md) to see whether this route's *world* is known
 *    to contain any gravel/cobble zones at all. If so, the route is marked
 *    `'unverified'` rather than silently asserting it's fully paved. If the
 *    world has no known non-tarmac zones, it falls back to "100% road"
 *    labelled as a plain heuristic assumption.
 *
 * It also derives a simple climb intensity profile from `distance`/`elevation`,
 * which *are* real, authoritative fields from zwift-data.
 */

interface CuratedSurfaceMix {
  road: number
  gravel: number
  cobble: number
  composition?: SurfaceComposition
}

function coarseComposition({ road, gravel, cobble }: Omit<CuratedSurfaceMix, 'composition'>): SurfaceComposition {
  return normalizeSurfaceComposition({
    tarmac: road,
    dirt: gravel,
    cobbles: cobble
  })
}

function curatedSurface(mix: CuratedSurfaceMix): SurfaceEstimate {
  return {
    road: mix.road,
    gravel: mix.gravel,
    cobble: mix.cobble,
    composition: normalizeSurfaceComposition(mix.composition ?? coarseComposition(mix)),
    confidence: 'curated'
  }
}

// slug -> approximate surface mix, for a route `routeSurfaces.generated.json`
// doesn't (and can't yet) cover: one with no `stravaSegmentId` in zwift-data
// at all, so `compute-route-surfaces.mjs` has no GPS trace to work from.
// Every route that used to be listed here now has real measured data instead
// (see `estimateSurface` below, which always checks generated data first) or
// has left the catalog - re-check this list whenever zwift-data adds a
// `stravaSegmentId` for an entry, since the curated entry becomes dead
// weight the moment generated data covers it too.
//
// The table has been empty since #324: its last entry,
// `handful-of-gravel-run` (90% gravel), was a running-only route and left the
// catalog with the rest of them. The table and `curatedSurface` stay for the
// next untraced route.
//
// `handful-of-gravel`, `jungle-circuit-rev` and `cobbled-crown` were dropped
// from here for exactly that reason once zwift-data gained their segment ids.
// Worth knowing how far the guesses were off: `jungle-circuit-rev` was
// carried as 55% road / 45% gravel and actually measures 94.6% dirt. Gravel
// wheels won it either way, so the ranking held - but blended road-wheel Crr
// goes 0.0094 -> 0.0154, so the curated figure understated the cost of the
// wrong wheel by a factor of six and made every finish-time estimate on the
// route optimistic. Curated percentages from route descriptions are a
// stopgap for ranking, not a second opinion on measured data, and they are
// worst exactly where they matter most - predicted time. `peaky-pave` went
// the same way with zwift-data 2.1: carried as 30% cobbles on the strength
// of its name, it measures 2.6% - the two Pavé Sprint stretches, 0.8 km of
// a 30.6 km lap, the same village cobbles every other traced France route
// shows at 3-6%. Road wheels won it either way.
//
// A curated entry carries percentages but no positions, so the simulator
// rides these routes as one block per surface, in share order, rather than
// at the real places the cobbles and gravel are - see
// `surfaceSegmentsFromComposition` for that approximation and issue #172 for
// why the previous behaviour (100% of the dominant surface, i.e. Peaky Pave
// as pure tarmac) was worse than an approximate layout.
const CURATED_SURFACE: Record<string, CuratedSurfaceMix> = {}

export function estimateSurface(route: Route): SurfaceEstimate {
  const measured = getGeneratedRouteSurface(route.slug)
  if (measured) {
    const composition = normalizeSurfaceComposition(measured.composition)
    // Trace km -> official km, here and nowhere else: this and `computeTerrain`
    // below are the only two doors the generated trace data comes through, so
    // rescaling at the door is what keeps a route's surfaces, its elevation
    // shape and its climb and sprint placements in one coordinate system
    // (issues #171, #319). The percentages are computed before/independently
    // of the scale and never move with it.
    return {
      ...coarsenSurfaceComposition(composition),
      composition,
      segments: rescaleSurfaceSegments(measured.segments, route.distance),
      leadInSegments: rescaleSurfaceSegments(measured.leadInSegments, route.leadInDistance),
      confidence: 'measured'
    }
  }

  const curated = CURATED_SURFACE[route.slug]
  if (curated) return curatedSurface(curated)

  const worldHasKnownZones = getWorldSurfaceZones(route.world).length > 0
  if (worldHasKnownZones) return { road: 100, gravel: 0, cobble: 0, confidence: 'unverified' }

  return { road: 100, gravel: 0, cobble: 0, confidence: 'heuristic' }
}

function terrainCategory(climbRatio: number): TerrainCategory {
  if (climbRatio < 6) return 'flat'
  if (climbRatio < 13) return 'rolling'
  if (climbRatio < 22) return 'hilly'
  return 'mountainous'
}

// Climb ratio (m of gain per km) below which climbing ability has a
// negligible effect on speed vs. aero drag - a small net rise/fall over a
// route's distance (e.g. gentle rollers) barely taxes weight/climb ability
// the way a real sustained gradient does, so scaling climb weight linearly
// from 0 (as before) gave weight-driven wheel choices (e.g. lightweight
// climb wheels) an outsized advantage over aero/disc wheels even on
// essentially flat routes - contradicting real Zwift racing behavior where
// aero dominates flat/rolling terrain almost entirely. Deadzone chosen as
// half of the "flat" category threshold (see `terrainCategory` above).
const CLIMB_DEADZONE_M_PER_KM = 3

/**
 * A route's climb or sprint placements in official km, the coordinates every
 * reader rides in (issue #319). zwift-data's `segmentsOnRoute` positions -
 * and the track-matched ones merged in beside them - are measured along the
 * route's community trace, not against its published distance: on 36 of the
 * 37 routes where the two can be told apart the last placement lands on the
 * trace's length. A lap placement is multiplied by the factor the lap's
 * measured surfaces are (`measuredTraceScale` over the generated segments,
 * as `estimateSurface` rescales them), so it meets the measured arrays where
 * the road does: unscaled, Innsbruck KOM After Party's KOM ended 166 m past
 * the finish. Both ends move by the same factor, so a placement selects
 * exactly the stretch of measured road it selected before the rescale.
 *
 * What a scaled placement still overhangs its lap by - under a metre on two
 * routes (Volcano KOM on Bambino Fondo, 0.50 m; Petit KOM on Petite Douleur,
 * 0.30 m) - is clamped to the lap, and one starting past it would be dropped
 * (none does), so every placement lies within its route's official length
 * and `scripts/validate-placements.mjs` can hold the catalog to that.
 *
 * Lead-in placements (`perLap: false`) are left as they are: they are
 * measured on the lead-in, which the lap's factor does not describe.
 * `lengthKm`, `elevationM` and the grade are the segment's own measurements,
 * not positions, and do not move either - a segment's ranked length is its
 * placement's `lengthKm` (`getAllSegmentSummaries`).
 */
export function placementsInOfficialKm<T extends Pick<RouteClimb, 'fromKm' | 'toKm' | 'perLap'>>(placements: T[], scale: number, lapKm: number): T[] {
  return placements.flatMap((placement) => {
    if (!placement.perLap) return [placement]
    const fromKm = placement.fromKm * scale
    if (fromKm >= lapKm) return []
    return [{ ...placement, fromKm, toKm: Math.min(placement.toKm * scale, lapKm) }]
  })
}

export function computeTerrain(route: Route): TerrainProfile {
  const climbRatio = route.distance > 0 ? route.elevation / route.distance : 0
  const category = terrainCategory(climbRatio)

  // 0 (flat) .. 1 (mountainous), ramping from the deadzone up to 30 m/km
  const climbFactor = Math.min(1, Math.max(0, (climbRatio - CLIMB_DEADZONE_M_PER_KM) / (30 - CLIMB_DEADZONE_M_PER_KM)))

  const weights: TerrainWeights = {
    aero: 1 - climbFactor,
    climb: climbFactor,
    gravel: 0,
    cobble: 0
  }

  const measured = getGeneratedRouteSurface(route.slug)
  // The factor `estimateSurface` rescales the lap's surfaces by.
  const lapScale = measuredTraceScale(measured?.segments?.[measured.segments.length - 1]?.toKm, route.distance)
  return {
    climbRatio,
    category,
    weights,
    climbs: placementsInOfficialKm(getRouteClimbs(route), lapScale, route.distance),
    sprints: placementsInOfficialKm(getRouteSprints(route), lapScale, route.distance),
    // Rescaled onto the official distance for the same reason the surface
    // segments are, with the same factor - see `estimateSurface` and #171.
    elevationProfile: rescaleElevationProfile(measured?.elevationProfile, route.distance),
    leadInElevationProfile: rescaleElevationProfile(measured?.leadInElevationProfile, route.leadInDistance)
  }
}
