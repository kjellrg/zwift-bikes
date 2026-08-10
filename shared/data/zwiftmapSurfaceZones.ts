import type { WorldSlug } from 'zwift-data'

/**
 * Reference catalog of known non-tarmac surface zones per Zwift world.
 *
 * -----------------------------------------------------------------------
 * THIRD-PARTY DATA NOTICE
 *
 * The location labels and surface classifications below are derived from
 * the hand-mapped `worldConfigs` surface polygons in:
 *
 *   zwiftmap (https://github.com/andipaetzold/zwiftmap)
 *   Copyright (c) 2021 Andi Pätzold
 *   Licensed under the MIT License - see /THIRD_PARTY_NOTICES.md
 *
 * zwiftmap draws these polygons over each world's map and intersects a
 * route's real GPS track (fetched from Strava) against them to compute an
 * exact per-route surface percentage. This file keeps just the *category* of
 * what each named location is known to be (gravel/dirt/sand/grass/snow ->
 * "gravel", cobbles/brick -> "cobble") as a lightweight, attributed
 * reference - the full polygon coordinates now live separately in
 * `zwiftmapSurfacePolygons.ts`, which `shared/utils/surfaceGeometry.ts` uses
 * to compute real per-route composition (see `scripts/route-surfaces/`).
 *
 * Known route-level surface estimates in `routeTerrain.ts` may additionally
 * carry a detailed zwiftmap-style surface composition, either generated (see
 * `routeSurfaces.ts`) or curated, which is used by finish-time Crr
 * calculations.
 *
 * This coarse label data is used to avoid silently asserting "100% road" for
 * routes in worlds that are known to contain gravel/cobble sections but
 * aren't yet covered by generated or curated per-route data - see the
 * `'unverified'` confidence level on `SurfaceEstimate`.
 * -----------------------------------------------------------------------
 */

export type WorldSurfaceCategory = 'gravel' | 'cobble'

export interface WorldSurfaceZone {
  /** Human-readable location label, adapted from zwiftmap's polygon comments. */
  label: string
  surface: WorldSurfaceCategory
}

export const WORLD_SURFACE_ZONES: Partial<Record<WorldSlug, WorldSurfaceZone[]>> = {
  bologna: [
    { label: 'unlabeled brick-paved section', surface: 'cobble' }
  ],
  'crit-city': [
    { label: 'unlabeled brick-paved section', surface: 'cobble' }
  ],
  france: [
    { label: 'bridge near start', surface: 'cobble' },
    { label: 'pavé sprint', surface: 'cobble' },
    { label: 'bridge to bottom-left island', surface: 'cobble' }
  ],
  innsbruck: [
    { label: 'unlabeled brick-paved section', surface: 'cobble' },
    { label: 'unlabeled cobbled section', surface: 'cobble' }
  ],
  london: [
    { label: 'left entry from city (Handling District)', surface: 'cobble' },
    { label: 'right exit towards city (Handling District)', surface: 'cobble' }
  ],
  'makuri-islands': [
    { label: 'north dirt section', surface: 'gravel' },
    { label: 'bridges/road between the lakes', surface: 'gravel' },
    { label: 'road between the Temple KOM bridges', surface: 'gravel' },
    { label: 'Temple KOM (fishing-village side)', surface: 'gravel' },
    { label: 'Temple KOM arc', surface: 'gravel' },
    { label: 'Temple KOM (castle side)', surface: 'gravel' },
    { label: 'before tunnel to Neokyo', surface: 'gravel' },
    { label: 'south islands: north road', surface: 'gravel' },
    { label: 'south islands: west (sand)', surface: 'gravel' },
    { label: 'south tunnel east entry', surface: 'gravel' },
    { label: 'coast of the main island', surface: 'gravel' },
    { label: 'north road on main island, from west (sandy causeway)', surface: 'gravel' },
    { label: 'west islands: road under bridge', surface: 'gravel' },
    { label: 'north islands: north/south road', surface: 'gravel' },
    { label: 'Castle', surface: 'cobble' },
    { label: 'Castle Sprint', surface: 'cobble' },
    { label: 'Alley Sprint (incl. reverse)', surface: 'cobble' },
    { label: 'Neokyo (incl. rooftop KOM sections)', surface: 'cobble' },
    { label: 'Arcade + start', surface: 'cobble' }
  ],
  paris: [
    { label: 'entire route network', surface: 'cobble' }
  ],
  richmond: [
    { label: 'top-left out-and-back climb', surface: 'cobble' },
    { label: 'Richmond KOM', surface: 'cobble' },
    { label: '23rd Street', surface: 'cobble' }
  ],
  scotland: [
    { label: 'south bridge', surface: 'cobble' },
    { label: 'east roundabout', surface: 'cobble' },
    { label: 'Sgurr Summit North', surface: 'gravel' }
  ],
  watopia: [
    { label: 'Jungle Circuit loop', surface: 'gravel' },
    { label: 'Jungle middle road (dirt sections)', surface: 'gravel' },
    { label: 'Repack Ridge', surface: 'gravel' },
    { label: 'Radio Tower (Alpe summit area)', surface: 'gravel' },
    { label: 'road between the Epic KOMs', surface: 'gravel' },
    { label: 'islands before West Epic KOM start', surface: 'gravel' },
    { label: 'southern coast beach', surface: 'gravel' },
    { label: 'Epic KOM (castle)', surface: 'cobble' },
    { label: 'Italian Village piazza', surface: 'cobble' },
    { label: 'Jungle middle road (brick sections)', surface: 'cobble' },
    { label: 'southern coast west town', surface: 'cobble' }
  ]
  // "new-york" and "yorkshire" have no non-tarmac zones in zwiftmap's data.
}

/** Known non-tarmac zones for a world, or an empty array if none are mapped. */
export function getWorldSurfaceZones(world: WorldSlug): WorldSurfaceZone[] {
  return WORLD_SURFACE_ZONES[world] ?? []
}
