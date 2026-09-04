import type { ClassifiedBikeFrame, ComboScore, ComboScoreBreakdown, RouteWithMeta, Wheelset } from '../types/catalog'
import { standardEquivalentClimbScore } from './physics/equipment'

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

// Off-road (gravel/cobble) suitability in Zwift's physics engine is
// determined *entirely* by the wheelset's Crr (rolling resistance) class,
// not the frame - see `classifyWheel.ts`'s CRR_GRAVEL_SCORE/CRR_COBBLE_SCORE
// comment, and ZwiftInsider's own writeup (https://zwiftinsider.com/crr/):
// "only the wheelset determines rolling resistance - frame choice has no
// effect. A rider on a Specialized Roubaix (road frame) with Road wheels
// performs identically to someone on a gravel-category frame with Road
// wheels on any surface." Any wheelset can also be mounted on any frame in
// Zwift, so there's no eligibility angle either.
//
// Previously the frame got a 0.25 weight here, sourced from
// `classifyBikeFrame.ts`'s `STYLE_PRESETS`/`CATEGORY_PRESETS` - real-world
// marketing labels (e.g. Roubaix = "endurance/cobble bike") with no bot-test
// data behind them, since ZwiftInsider's frame speed tests
// (https://zwiftinsider.com/charts-frames/) only cover flat and climb
// courses, never cobbles/gravel. That fictional bonus was large enough
// (endurance preset cobble=78 vs. an aero/allrounder frame's 18-38) to flip
// route rankings on cobble-heavy routes - e.g. a Specialized Roubaix S-Works
// outscoring a Tarmac SL9 despite the SL9's real, measured aero/climb
// advantage carrying almost no weight once cobblestones dominate the route.
const OFFROAD_FRAME_WEIGHT = 0
const OFFROAD_WHEELSET_WEIGHT = 1

function blendOffroad(frameValue: number, wheelsetValue: number): number {
  return frameValue * OFFROAD_FRAME_WEIGHT + wheelsetValue * OFFROAD_WHEELSET_WEIGHT
}

// Disc wheels get a real, disc-specific extra aero advantage on TT frames -
// see `physics/equipment.ts`'s `TT_DISC_RESIDUAL_CDA_DELTA_M2` comment for
// the exact ZwiftInsider per-wheel Road-vs-TT data this is derived from. That fix
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
//
// The bonus represents an *aero* advantage, so - like `breakdown.aero`
// itself - it must scale down with the route's aero relevance
// (`aeroWeight / totalWeight`). Previously it was a flat +8 regardless of
// surface, which meant it still applied at full strength even on a
// 100%-cobblestone route (aeroWeight = 0, since cobbles zero out
// `roadFactor`), incorrectly ranking TT+disc combos above equal- or
// better-scoring road combos on routes where aero contributes nothing to
// the score at all.
const TT_DISC_SCORE_BONUS = 8

export function scoreCombo(route: RouteWithMeta, frame: ClassifiedBikeFrame, wheelset: Wheelset | undefined): ComboScore {
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
  // that doesn't actually exist in Zwift. `wheelset` is `undefined` for
  // exactly these frames (see `rankCombos`) - checking `!wheelset` alongside
  // `frame.hasFixedWheels` (rather than just the latter) lets every branch
  // below narrow to a definitely-defined `wheelset` without a `!` assertion.
  const combinedAero = frame.hasFixedWheels || !wheelset ? frame.scores.aero : blend(frame.scores.aero, wheelset.scores.aero)
  const rawCombinedClimb = frame.hasFixedWheels || !wheelset ? frame.scores.climb : blend(frame.scores.climb, wheelset.scores.climb)
  const combinedClimb = standardEquivalentClimbScore(rawCombinedClimb, frame.category === 'tt')
  const combinedGravel = frame.hasFixedWheels || !wheelset ? frame.scores.gravel : blendOffroad(frame.scores.gravel, wheelset.scores.gravel)
  const combinedCobble = frame.hasFixedWheels || !wheelset ? frame.scores.cobble : blendOffroad(frame.scores.cobble, wheelset.scores.cobble)

  const breakdown: ComboScoreBreakdown = {
    aero: Math.round((aeroWeight / totalWeight) * combinedAero),
    climb: Math.round((climbWeight / totalWeight) * combinedClimb),
    gravel: Math.round((gravelFactor / totalWeight) * combinedGravel),
    cobble: Math.round((cobbleFactor / totalWeight) * combinedCobble)
  }

  // Disc-ness is a property of the REAR wheel - see `Wheelset.rear` in
  // `shared/types/catalog.ts` (issue #150).
  const isTtDisc = !frame.hasFixedWheels && !!wheelset && frame.category === 'tt' && wheelset.rear.category === 'disc'
  const aeroRelevance = aeroWeight / totalWeight
  // `aeroRelevance` is a fraction, not a whole number, so scaling the bonus
  // by it (see `TT_DISC_SCORE_BONUS`'s comment) can leave `score` with a
  // fractional remainder even though every other term is already a rounded
  // integer - round the whole sum so the displayed score is always whole.
  const score = Math.round(breakdown.aero + breakdown.climb + breakdown.gravel + breakdown.cobble + (isTtDisc ? TT_DISC_SCORE_BONUS * aeroRelevance : 0))

  return { frame, wheelset, score, breakdown }
}

// How many distinct wheelset choices a single frame can contribute to a
// *displayed* results page - see `capWheelsetsPerFrame` below, which is the
// only place this is applied. It must never be applied inside `rankCombos`
// itself: `rankCombos` is the source of truth both `search` and finish-time
// ranking operate on, and collapsing wheelsets there - before either of
// those ever run - silently deleted every non-surviving wheelset from
// existence. That was harmless when scores were finely spread out, but on
// a route where many wheelsets tie exactly (e.g. every Road-class wheel
// scores identically on a 100%-cobblestone route, since cobble/gravel
// scoring is now purely wheel-Crr-class-driven - see `OFFROAD_FRAME_WEIGHT`
// above), only ONE wheel per frame ever survived, chosen arbitrarily by
// array order - hiding 78 of 79 real Road wheels from both the results list
// and `search`, the same way the frame-level pagination bug once hid Tarmac.
const MAX_WHEELSETS_PER_FRAME = 3

// Zwift's garage/drop shop only lets you pair a gravel frame with a
// gravel/mountain-class wheelset, and a road or TT frame with a road-class
// wheelset - you can't put knobby gravel tires on a road/TT bike, or road
// tires on a gravel bike. `Wheelset.crrClass` (see `classifyWheel.ts`)
// already encodes exactly this grouping ('road' | 'gravel' | 'mountain'),
// including the one "Zwift Mountain" wheel, which pairs with the "Zwift
// Mountain" frame that this app's `gravel` `BikeCategory` already absorbs
// (there's no separate mountain-bike category). `handbike`/`funbike` frames
// aren't restricted here - they're novelty categories Zwift doesn't apply
// this rule to in the same way, and most already bypass wheel choice
// entirely via `hasFixedWheels`.
function isWheelsetCompatible(frame: ClassifiedBikeFrame, wheelset: Wheelset): boolean {
  if (frame.category === 'gravel') return wheelset.crrClass !== 'road'
  if (frame.category === 'standard' || frame.category === 'tt') return wheelset.crrClass === 'road'
  return true
}

export function rankCombos(route: RouteWithMeta, frames: ClassifiedBikeFrame[], wheelsets: Wheelset[], limit = 10): ComboScore[] {
  const combos: ComboScore[] = []

  for (const frame of frames) {
    if (frame.hasFixedWheels) {
      // Not a real wheel choice - Zwift doesn't let you swap these frames'
      // integrated wheels, so score with no wheelset at all (`scoreCombo`/
      // `estimateFinishTimeSec` ignore it for these frames anyway) rather
      // than grabbing a throwaway one from `wheelsets` - that pool can be
      // filtered down to nothing (e.g. an owned-wheels-only filter with no
      // wheels owned yet) without these frames needing a real wheel to
      // exist at all, unlike every other frame below.
      combos.push(scoreCombo(route, frame, undefined))
      continue
    }

    const compatibleWheelsets = wheelsets.filter(w => isWheelsetCompatible(frame, w))
    for (const wheelset of compatibleWheelsets) {
      combos.push(scoreCombo(route, frame, wheelset))
    }
  }

  combos.sort((a, b) => b.score - a.score)
  return combos.slice(0, limit)
}

/**
 * Caps how many wheelset rows a single frame contributes to an
 * already-fully-ranked/searched `combos` list, keeping only its first
 * `maxPerFrame` entries in whatever order the list is already sorted in
 * (real finish time when a rider profile is known, otherwise `score` - see
 * callers). This is purely cosmetic decluttering for a *displayed* page -
 * e.g. keeping "Tarmac SL9" from showing up to 79 times, once per wheel
 * colourway, while still letting it earn a few rows when it genuinely has
 * more than one competitive wheel choice (an aero wheel and a climbing
 * wheel that are both good picks depending on the route). Ties on the exact
 * same value (almost always literal colourways of the same physical wheel,
 * e.g. "Princeton Wake 6560 White"/"...Lava") collapse to a single
 * representative rather than each consuming one of the `maxPerFrame` slots.
 *
 * Must only run on a list that both `search` and ranking have already had
 * their say on - never inside `rankCombos` itself. Applying it earlier
 * deleted the non-surviving wheelsets before search or finish-time ranking
 * ever saw them, permanently hiding them (see `MAX_WHEELSETS_PER_FRAME`'s
 * comment) - so callers should skip this step entirely while a `search`
 * filter is active, to keep every real match reachable.
 */
/**
 * Applies a `search` term (already trimmed and lowercased by the caller) to an
 * already-fully-ranked `combos` list: every row matching on either half of the
 * combo is kept, but rows whose FRAME name matches are listed ahead of rows
 * that only matched on the wheelset name. Each half keeps the order it already
 * had - real finish time when a rider profile is known, otherwise `score`.
 *
 * Matching the wheelset name too is what lets someone look up a wheel by name,
 * and that stays. But a wheelset name can also drag in frames that have
 * nothing to do with what was typed, since a road-class wheelset fits nearly
 * every road frame: the wheelset literally named "Zwift Concept" put 39
 * unrelated climbing frames above the "Zwift Concept Z1" itself on a
 * climb-heavy route (issue #25). Someone typing a bike's name almost always
 * means the bike, so frame matches go first.
 *
 * Unlike `capWheelsetsPerFrame` this only reorders - no real match is ever
 * dropped, and a pure wheel search (where no frame name matches the term at
 * all) comes out exactly as it went in.
 */
export function searchCombos(combos: ComboScore[], search: string): ComboScore[] {
  const matchesFrameName = (combo: ComboScore) => combo.frame.name.toLowerCase().includes(search)
  const hits = combos.filter(combo => matchesFrameName(combo) || combo.wheelset?.name.toLowerCase().includes(search))
  return [...hits.filter(matchesFrameName), ...hits.filter(combo => !matchesFrameName(combo))]
}

/**
 * How many distinct wheel answers each frame has in an already-ranked pool -
 * the number a result card shows on its "other wheels for this bike"
 * disclosure, and the number of rows the drill-down will actually return.
 *
 * Counted on the same `valueOf` `capWheelsetsPerFrame` dedupes by, and for the
 * same reason: two wheelsets that produce an identical time are one answer
 * wearing two names (almost always colourways of one physical wheel), and
 * offering "62 wheel options" that turn out to be 40 ties would be a worse
 * lie than showing three of them was. A `hasFixedWheels` frame contributes a
 * single combo with no wheelset, so it counts 1 and gets no disclosure -
 * which is correct: Zwift will not let it swap.
 *
 * Runs over the FULL ranked pool, never a page of it: the whole point is to
 * tell a rider about wheels that did not make the page.
 */
export function countWheelOptionsByFrame(combos: ComboScore[], valueOf: (combo: ComboScore) => number): Map<number, number> {
  const valuesByFrame = new Map<number, Set<number>>()
  for (const combo of combos) {
    const seen = valuesByFrame.get(combo.frame.id) ?? new Set<number>()
    seen.add(valueOf(combo))
    valuesByFrame.set(combo.frame.id, seen)
  }
  return new Map([...valuesByFrame].map(([frameId, values]) => [frameId, values.size]))
}

export function capWheelsetsPerFrame(combos: ComboScore[], valueOf: (combo: ComboScore) => number, maxPerFrame = MAX_WHEELSETS_PER_FRAME): ComboScore[] {
  const seenValuesByFrame = new Map<number, Set<number>>()
  const result: ComboScore[] = []
  for (const combo of combos) {
    const value = valueOf(combo)
    const seen = seenValuesByFrame.get(combo.frame.id) ?? new Set<number>()
    if (seen.has(value)) continue
    if (seen.size >= maxPerFrame) continue
    seen.add(value)
    seenValuesByFrame.set(combo.frame.id, seen)
    result.push(combo)
  }
  return result
}
