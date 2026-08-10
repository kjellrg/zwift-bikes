import type { SurfaceComposition, ZwiftSurfaceType } from '../types/catalog'

export type WheelCrrClass = 'road' | 'gravel' | 'mountain'

/**
 * Zwift rolling-resistance values by surface and wheel Crr class, verified
 * directly against ZwiftInsider's published Crr table
 * (https://zwiftinsider.com/crr/, confirmed via two independent fetches
 * quoting the table verbatim - not a single AI-paraphrased summary).
 *
 * zwiftmap names the wheel classes Road/Gravel/MTB; this app stores the same
 * concept as road/gravel/mountain on each classified wheelset.
 *
 * **Bug found + fixed (user-reported, real-rider comparison against
 * zwifterbikes.com): a road-class wheel on Serpentine 8 (87% dirt) and Climb
 * Control (64% gravel-type surface) came out 13-23% slower than
 * zwifterbikes' reported time on the exact same combo, while paved/cobbled
 * routes agreed within a few percent.** Traced to this table: the previous
 * `dirt` row (.025/.018/.014) was actually ZwiftInsider's real `grass` row
 * (.025/.016/.014, an almost exact match) - apparently copy-pasted into the
 * wrong slot at some point - while `grass` itself was left with an invented
 * `mountain: .042` "high penalty" placeholder and `null` for road/gravel,
 * based on a comment claiming zwiftmap marks grass "unavailable" for those
 * classes. The real table has defined values for every class on every
 * surface, including grass - that assumption was simply wrong. `gravel`'s
 * `mountain` value was also backwards (.009, better than reality's .014),
 * and `snow`'s road/gravel values didn't match at all. Only the previously
 * grass-only `null` capability and its fallback (`blendedCrr` in
 * `finishTime.ts`, `rollingResistanceCoefficient` in `physics/forces.ts`)
 * are now unused by this table, but kept as a defensive fallback for any
 * future surface Zwift adds before this table is updated for it.
 */
export const SURFACE_CRR: Record<ZwiftSurfaceType, Record<WheelCrrClass, number | null>> = {
  tarmac: { road: 0.004, gravel: 0.008, mountain: 0.009 },
  brick: { road: 0.0055, gravel: 0.008, mountain: 0.009 },
  wood: { road: 0.0065, gravel: 0.008, mountain: 0.009 },
  cobbles: { road: 0.0065, gravel: 0.008, mountain: 0.009 },
  snow: { road: 0.0055, gravel: 0.006, mountain: 0.014 },
  dirt: { road: 0.016, gravel: 0.009, mountain: 0.01 },
  grass: { road: 0.025, gravel: 0.016, mountain: 0.014 },
  sand: { road: 0.004, gravel: 0.008, mountain: 0.009 },
  gravel: { road: 0.012, gravel: 0.006, mountain: 0.014 }
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
