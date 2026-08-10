import type { WorldSlug } from 'zwift-data'
import type { ZwiftSurfaceType } from '../types/catalog'
import polygonsByWorld from './zwiftmapSurfacePolygons.json'

/**
 * Hand-mapped per-world surface polygons, extracted from zwiftmap's
 * `worldConfigs/*.ts` (https://github.com/andipaetzold/zwiftmap, MIT
 * licensed - see /THIRD_PARTY_NOTICES.md) via
 * `scripts/route-surfaces/extract-surface-polygons.mjs`. Any lat/lng point
 * that doesn't fall inside one of these polygons is plain tarmac - see
 * `surfaceGeometry.ts`'s `computeSurfaceComposition`, which uses this the
 * same way zwiftmap's own `getSurfaceStream` does.
 */
export interface WorldSurfacePolygon {
  type: ZwiftSurfaceType
  /** Closed ring of [lat, lng] pairs (first point repeated as the last). */
  polygon: [number, number][]
}

const POLYGONS_BY_WORLD = polygonsByWorld as unknown as Record<string, WorldSurfacePolygon[]>

/** Known non-tarmac surface polygons for a world, or an empty array if none are mapped. */
export function getWorldSurfacePolygons(world: WorldSlug): WorldSurfacePolygon[] {
  return POLYGONS_BY_WORLD[world] ?? []
}
