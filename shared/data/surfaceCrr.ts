import type { SurfaceComposition, ZwiftSurfaceType } from '../types/catalog'

export type WheelCrrClass = 'road' | 'gravel' | 'mountain'

/**
 * Zwift rolling-resistance values by surface and wheel Crr class, adapted from
 * zwiftmap's CRR table, which cites ZwiftInsider's published Crr data.
 *
 * zwiftmap names the wheel classes Road/Gravel/MTB; this app stores the same
 * concept as road/gravel/mountain on each classified wheelset.
 */
export const SURFACE_CRR: Record<ZwiftSurfaceType, Record<WheelCrrClass, number | null>> = {
  tarmac: { road: 0.004, gravel: 0.008, mountain: 0.01 },
  brick: { road: 0.0055, gravel: 0.008, mountain: 0.01 },
  wood: { road: 0.0065, gravel: 0.008, mountain: 0.01 },
  cobbles: { road: 0.0065, gravel: 0.008, mountain: 0.01 },
  snow: { road: 0.0075, gravel: 0.018, mountain: 0.014 },
  dirt: { road: 0.025, gravel: 0.018, mountain: 0.014 },
  grass: { road: null, gravel: null, mountain: 0.042 },
  sand: { road: 0.004, gravel: 0.008, mountain: 0.014 },
  gravel: { road: 0.012, gravel: 0.009, mountain: 0.009 }
}

export function normalizeSurfaceComposition(composition: SurfaceComposition): SurfaceComposition {
  const total = Object.values(composition).reduce((sum, value) => sum + (value ?? 0), 0)
  if (total <= 0) return { tarmac: 100 }

  return Object.fromEntries(
    Object.entries(composition)
      .filter(([, value]) => value !== undefined && value > 0)
      .map(([surface, value]) => [surface, (value / total) * 100])
  ) as SurfaceComposition
}

/**
 * Collapses a detailed zwiftmap-style composition into the coarse
 * road/gravel/cobble split `SurfaceEstimate` exposes for simple UI badges
 * and filtering. Brick/wood/cobbles are bumpy-but-fixed surfaces (bucketed
 * as "cobble"); dirt/snow/grass/sand/gravel are loose surfaces (bucketed as
 * "gravel") - matching the existing convention in `routeTerrain.ts`'s
 * curated data (e.g. `canopies-and-coastlines`'s wood boardwalk -> cobble).
 */
export function coarsenSurfaceComposition(composition: SurfaceComposition): { road: number, gravel: number, cobble: number } {
  const road = composition.tarmac ?? 0
  const cobble = (composition.brick ?? 0) + (composition.wood ?? 0) + (composition.cobbles ?? 0)
  const gravel = (composition.dirt ?? 0) + (composition.snow ?? 0) + (composition.grass ?? 0) + (composition.sand ?? 0) + (composition.gravel ?? 0)
  return { road, gravel, cobble }
}
