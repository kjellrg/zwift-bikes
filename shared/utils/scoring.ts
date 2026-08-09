import type { ClassifiedBikeFrame, ComboScore, ComboScoreBreakdown, RouteWithMeta, Wheelset } from '../types/catalog'

/**
 * Combines a route's terrain/surface profile with a frame + wheelset's
 * heuristic scores into a single 0-100 suitability score.
 *
 * The route contributes a weight vector (how much aero/climb/gravel/cobble
 * ability matters for this specific route), and the equipment contributes
 * how good it is in each of those dimensions. The final score is simply the
 * weighted sum, so it stays easy to explain in the UI.
 */

const FRAME_WEIGHT = 0.6
const WHEELSET_WEIGHT = 0.4

/** Combines a frame's and wheelset's score for the same dimension (aero/climb), weighted 60/40. Exported for reuse by `finishTime.ts`. */
export function blend(frameValue: number, wheelsetValue: number): number {
  return frameValue * FRAME_WEIGHT + wheelsetValue * WHEELSET_WEIGHT
}

// Off-road (gravel/cobble) suitability is driven almost entirely by the
// *wheel's* real Zwift Crr (rolling resistance) class, not the frame - see
// `classifyWheel.ts`. The frame still gets a modest weight, since a
// gravel-category frame is what actually lets you mount gravel wheels in
// the first place, but the wheelset's real Crr-derived score should
// dominate the blend.
const OFFROAD_FRAME_WEIGHT = 0.25
const OFFROAD_WHEELSET_WEIGHT = 0.75

function blendOffroad(frameValue: number, wheelsetValue: number): number {
  return frameValue * OFFROAD_FRAME_WEIGHT + wheelsetValue * OFFROAD_WHEELSET_WEIGHT
}

// Disc wheels get a real, disc-specific extra aero advantage on TT frames -
// see `finishTime.ts`'s `TT_DISC_CDA_MULTIPLIER` comment for the exact
// ZwiftInsider per-wheel Road-vs-TT data this is derived from. That fix
// makes `estimateFinishTimeSec` correctly show disc wheels as fastest on TT
// frames, but this `score` (used to rank/sort combos) blends aero/climb via
// a simple weighted sum with no equivalent adjustment - the disc wheel's
// large climb-score penalty (real weight tradeoff, e.g. 31 vs 78 for a
// non-disc aero wheel) was outweighing its small aero-score edge in the
// blend, so disc+TT combos ranked below (and were often filtered off the
// visible list by) slower non-disc wheels, even on routes where the disc
// wheel is genuinely faster. The gap is too large to represent through the
// normal aero-score blend weighting (the aero score's total swing is
// deliberately modest), so it's applied as a direct bonus to the final
// score instead, mirroring the CdA multiplier's magnitude.
const TT_DISC_SCORE_BONUS = 8

export function scoreCombo(route: RouteWithMeta, frame: ClassifiedBikeFrame, wheelset: Wheelset): ComboScore {
  const { terrain, surface } = route

  const gravelFactor = surface.gravel / 100
  const cobbleFactor = surface.cobble / 100
  const roadFactor = Math.max(0, 1 - gravelFactor - cobbleFactor)

  const aeroWeight = roadFactor * terrain.weights.aero
  const climbWeight = roadFactor * terrain.weights.climb

  const totalWeight = aeroWeight + climbWeight + gravelFactor + cobbleFactor || 1

  // Frames with fixed (non-swappable) wheels already have their integrated
  // wheel's contribution baked into their own measured aero/climb data - see
  // `classifyBikeFrame.ts`'s `FIXED_WHEEL_FRAMES` comment. Blending in
  // whatever wheelset they happen to be paired with here would both
  // double-count that wheel effect and, worse, misrepresent a wheel choice
  // that doesn't actually exist in Zwift.
  const combinedAero = frame.hasFixedWheels ? frame.scores.aero : blend(frame.scores.aero, wheelset.scores.aero)
  const combinedClimb = frame.hasFixedWheels ? frame.scores.climb : blend(frame.scores.climb, wheelset.scores.climb)
  const combinedGravel = frame.hasFixedWheels ? frame.scores.gravel : blendOffroad(frame.scores.gravel, wheelset.scores.gravel)
  const combinedCobble = frame.hasFixedWheels ? frame.scores.cobble : blendOffroad(frame.scores.cobble, wheelset.scores.cobble)

  const breakdown: ComboScoreBreakdown = {
    aero: Math.round((aeroWeight / totalWeight) * combinedAero),
    climb: Math.round((climbWeight / totalWeight) * combinedClimb),
    gravel: Math.round((gravelFactor / totalWeight) * combinedGravel),
    cobble: Math.round((cobbleFactor / totalWeight) * combinedCobble)
  }

  const isTtDisc = !frame.hasFixedWheels && frame.category === 'tt' && wheelset.front.category === 'disc'
  const score = breakdown.aero + breakdown.climb + breakdown.gravel + breakdown.cobble + (isTtDisc ? TT_DISC_SCORE_BONUS : 0)

  return { frame, wheelset, score, breakdown }
}

export function rankCombos(route: RouteWithMeta, frames: ClassifiedBikeFrame[], wheelsets: Wheelset[], limit = 10): ComboScore[] {
  const combos: ComboScore[] = []

  for (const frame of frames) {
    if (frame.hasFixedWheels) {
      // Not a real wheel choice - Zwift doesn't let you swap these frames'
      // integrated wheels, so only emit a single combo (any wheelset works
      // here since `scoreCombo`/`estimateFinishTimeSec` ignore it for these
      // frames) and drop the wheelset from the result so the UI/API don't
      // present a fake pairing.
      const representative = wheelsets[0]
      if (!representative) continue
      const combo = scoreCombo(route, frame, representative)
      combos.push({ ...combo, wheelset: undefined })
      continue
    }

    for (const wheelset of wheelsets) {
      combos.push(scoreCombo(route, frame, wheelset))
    }
  }

  combos.sort((a, b) => b.score - a.score)
  return combos.slice(0, limit)
}
