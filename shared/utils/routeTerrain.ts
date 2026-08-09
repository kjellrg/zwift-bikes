import type { Route } from 'zwift-data'
import type { SurfaceEstimate, TerrainCategory, TerrainProfile, TerrainWeights } from '../types/catalog'
import { getWorldSurfaceZones } from '../data/zwiftmapSurfaceZones'

/**
 * `zwift-data` doesn't expose surface composition (road/gravel/cobbles) for
 * routes. The vast majority of Zwift routes are fully paved, with a small,
 * well-known set of routes built specifically to include gravel or cobbled
 * sections. This module:
 *
 * 1. Uses a curated table for that known set of gravel/cobble routes
 *    (approximate percentages, based on public route descriptions).
 * 2. For everything else, checks `zwiftmapSurfaceZones` (community-mapped
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

// slug -> approximate surface mix. Percentages are rough estimates, not
// measured from route geometry.
const CURATED_SURFACE: Record<string, { road: number, gravel: number, cobble: number }> = {
  'handful-of-gravel': { road: 10, gravel: 90, cobble: 0 },
  'handful-of-gravel-run': { road: 10, gravel: 90, cobble: 0 },
  'jungle-circuit': { road: 55, gravel: 45, cobble: 0 },
  'jungle-circuit-rev': { road: 55, gravel: 45, cobble: 0 },
  'repack-rush': { road: 20, gravel: 80, cobble: 0 },
  'the-muckle-yin': { road: 70, gravel: 30, cobble: 0 },
  'peaky-pave': { road: 70, gravel: 0, cobble: 30 },
  'cobbled-climbs': { road: 60, gravel: 0, cobble: 40 },
  'cobbled-climbs-run': { road: 60, gravel: 0, cobble: 40 },
  'cobbled-climbs-rev': { road: 60, gravel: 0, cobble: 40 },
  'cobbled-crown': { road: 75, gravel: 0, cobble: 25 },
  'petit-boucle': { road: 85, gravel: 0, cobble: 15 },
  'casse-pattes': { road: 80, gravel: 0, cobble: 20 },
  'petite-douleur': { road: 85, gravel: 0, cobble: 15 },
  'farmland-loop': { road: 70, gravel: 30, cobble: 0 },
  // Exact figures from zwiftmap's per-route surface breakdown (Tarmac
  // 19.8km/87%, Brick 1.8km/8%, Wood 538m/2%, Dirt 572m/3%) - wood
  // boardwalk bucketed under "cobble" (bumpy, not loose like dirt/gravel).
  'canopies-and-coastlines': { road: 87, gravel: 3, cobble: 10 }
}

export function estimateSurface(route: Route): SurfaceEstimate {
  const curated = CURATED_SURFACE[route.slug]
  if (curated) return { ...curated, confidence: 'curated' }

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

  return { climbRatio, category, weights }
}
