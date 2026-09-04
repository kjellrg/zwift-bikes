import type { Route } from 'zwift-data'
import type { SurfaceComposition, SurfaceEstimate, TerrainCategory, TerrainProfile, TerrainWeights } from '../types/catalog'
import { getWorldSurfaceZones } from '../data/zwiftmapSurfaceZones'
import { coarsenSurfaceComposition, normalizeSurfaceComposition } from '../data/surfaceCrr'
import { getGeneratedRouteSurface } from '../data/routeSurfaces'
import { getRouteClimbs, getRouteSprints } from './routeClimbs'
import { rescaleElevationProfile, rescaleSurfaceSegments } from './traceScale'

/**
 * `zwift-data` doesn't expose surface composition (road/gravel/cobbles) for
 * routes. This module:
 *
 * 1. Uses `routeSurfaces.ts`'s generated data where available - real
 *    per-route composition computed from each route's actual GPS trace, the
 *    same way zwiftmap.com does it (see `scripts/route-surfaces/`).
 * 2. Falls back to a curated table for a small, well-known set of
 *    gravel/cobble routes not yet covered by generated data (approximate
 *    percentages, based on public route descriptions).
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

// slug -> approximate surface mix, for the small remaining set of routes
// `routeSurfaces.generated.json` doesn't (and can't yet) cover: they have no
// `stravaSegmentId` in zwift-data at all, so `compute-route-surfaces.mjs`
// has no GPS trace to work from. Every other route that used to be listed
// here now has real measured data instead (see `estimateSurface` below,
// which always checks generated data first) - re-check this list whenever
// zwift-data adds a `stravaSegmentId` for one of these, since the curated
// entry becomes dead weight the moment generated data covers it too.
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
// worst exactly where they matter most - predicted time.
//
// A curated entry carries percentages but no positions, so the simulator
// rides these routes as one block per surface, in share order, rather than
// at the real places the cobbles and gravel are - see
// `surfaceSegmentsFromComposition` for that approximation and issue #172 for
// why the previous behaviour (100% of the dominant surface, i.e. Peaky Pave
// as pure tarmac) was worse than an approximate layout.
const CURATED_SURFACE: Record<string, CuratedSurfaceMix> = {
  'handful-of-gravel-run': { road: 10, gravel: 90, cobble: 0 },
  'peaky-pave': { road: 70, gravel: 0, cobble: 30 }
}

export function estimateSurface(route: Route): SurfaceEstimate {
  const measured = getGeneratedRouteSurface(route.slug)
  if (measured) {
    const composition = normalizeSurfaceComposition(measured.composition)
    // Trace km -> official km, here and nowhere else: this and `computeTerrain`
    // below are the only two doors the generated trace data comes through, so
    // rescaling both at the door is what keeps a route's surfaces and its
    // elevation shape in one coordinate system (issue #171). The percentages
    // are computed before/independently of the scale and never move with it.
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
  return {
    climbRatio,
    category,
    weights,
    climbs: getRouteClimbs(route),
    sprints: getRouteSprints(route),
    // Rescaled onto the official distance for the same reason the surface
    // segments are, with the same factor - see `estimateSurface` and #171.
    elevationProfile: rescaleElevationProfile(measured?.elevationProfile, route.distance),
    leadInElevationProfile: rescaleElevationProfile(measured?.leadInElevationProfile, route.leadInDistance)
  }
}
