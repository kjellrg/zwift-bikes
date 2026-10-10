import type { TerrainCategory, ZwiftSurfaceType } from '../types/catalog'

/**
 * A course's terrain and surfaces in the rider's words. Here rather than in
 * `app/utils/labels.ts`, where they used to live, for the reason given in
 * `units.ts`: the Ride statement names them, and its twin is rendered on the
 * server.
 */

export const TERRAIN_LABELS: Record<TerrainCategory, string> = {
  flat: 'Flat',
  rolling: 'Rolling',
  hilly: 'Hilly',
  mountainous: 'Mountainous'
}

export const SURFACE_TYPE_LABELS: Record<ZwiftSurfaceType, string> = {
  tarmac: 'Tarmac',
  brick: 'Brick',
  wood: 'Wood',
  cobbles: 'Cobbles',
  snow: 'Snow',
  dirt: 'Dirt',
  grass: 'Grass',
  sand: 'Sand',
  gravel: 'Gravel'
}
