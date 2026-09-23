import type { ComboTiming } from '../../shared/types/recommendRide'
import type { ClimbTrade } from '../../shared/types/rideNotes'
import type { RouteClimbOccurrence } from '../../shared/utils/routeOccurrences'

/**
 * The Climb trade (see `CONTEXT.md`): one setup that is slower over the whole
 * Ride but quicker over a named climb's last pass, with both numbers, for a
 * racer to weigh. Race drafting assumes the rider stays in the bunch to the
 * line - `docs/race-drafting.md` rejected modelling the drop - so the Ranking
 * cannot say that a lighter setup gets over the climb where the field splits
 * sooner. This note does, and leaves the choice to the rider: it never
 * reorders the Ranking or changes a finish time.
 *
 * Code and physics only. A judgement model was tried on this exact question
 * and gave the same answer whether the setup cost 8 s or 90 s over the race
 * (issue #258).
 */

export interface ClimbTradeCandidate {
  frameName: string
  wheelsetName?: string
  sameFrame: boolean
  timing: ComboTiming
}

/**
 * Absolute, not relative: the largest gain measured anywhere was 0.62% of a
 * climb, so a relative threshold never fired (issue #258, measured
 * 2026-09-23). The Innsbruck KOM trade that started the issue - 21 s on the
 * KOM for 8 s over the race - clears both with room to spare.
 */
export const CLIMB_TRADE_MIN_GAIN_SEC = 5
export const CLIMB_TRADE_MAX_COST_SEC = 30

/**
 * How many Garage frames the ranking never simulated may be timed for the
 * Climb trade: one integration each, on the first page only, so a Garage
 * that holds dozens of frames cannot double what the page costs.
 */
export const CLIMB_TRADE_GARAGE_SIMS = 10

/**
 * The one trade worth naming, or none. `climbs` are the Ride's passes in the
 * order each timing's `climbSec` follows. Each climb is judged on its LAST
 * pass - the one a race is decided on - and among the setups that clear both
 * thresholds, the largest gain wins, then the smaller cost.
 */
export function pickClimbTrade(
  climbs: readonly Pick<RouteClimbOccurrence, 'name' | 'slug' | 'rideFromKm' | 'lapNumber'>[],
  rank1: ComboTiming,
  candidates: readonly ClimbTradeCandidate[]
): ClimbTrade | undefined {
  const passesBySlug = new Map<string, number[]>()
  for (const [index, climb] of climbs.entries()) passesBySlug.set(climb.slug, [...(passesBySlug.get(climb.slug) ?? []), index])

  let best: ClimbTrade | undefined
  for (const candidate of candidates) {
    const costSec = candidate.timing.finishSec - rank1.finishSec
    if (costSec < 0 || costSec > CLIMB_TRADE_MAX_COST_SEC) continue
    for (const passes of passesBySlug.values()) {
      const last = passes.reduce((latest, index) => (climbs[index]!.rideFromKm > climbs[latest]!.rideFromKm ? index : latest))
      const gainSec = rank1.climbSec[last]! - candidate.timing.climbSec[last]!
      if (gainSec < CLIMB_TRADE_MIN_GAIN_SEC) continue
      if (best && (gainSec < best.gainSec || (gainSec === best.gainSec && costSec >= best.costSec))) continue
      best = {
        frameName: candidate.frameName,
        wheelsetName: candidate.wheelsetName,
        sameFrame: candidate.sameFrame,
        climbName: climbs[last]!.name,
        passes: passes.length,
        lapNumber: climbs[last]!.lapNumber,
        gainSec,
        costSec
      }
    }
  }
  return best
}
