import type { WheelKind } from '../utils/physics/simulatedOrdering'

/**
 * What the recommend endpoints say about rank 1 beyond its own row - the
 * numbers behind two lines that tell a racer what the Ranking assumes away:
 * that they stay with the group on the climbs (issues #258, #261). Shared by
 * the pipeline that computes them and the pages that word them, so the two
 * can only disagree about the words.
 */

/**
 * The Climb trade (see `CONTEXT.md`): one setup slower over the whole Ride
 * but quicker over a named climb's last pass - see `pickClimbTrade` in
 * `server/utils/climbTrade.ts`.
 */
export interface ClimbTrade {
  frameName: string
  wheelsetName?: string
  /** Rank 1's own frame on the other kind of wheel, rather than another bike. */
  sameFrame: boolean
  climbName: string
  /** How many times the Ride passes the climb; the trade is measured on the last. */
  passes: number
  /** The lap the last pass is on, when more than one lap is ridden. */
  lapNumber?: number
  /** How much sooner the setup gets over the climb's last pass, s. */
  gainSec: number
  /** How much later it finishes the Ride, s. */
  costSec: number
}

/**
 * The numbers behind the Wheel close call (see `CONTEXT.md`): rank 1's own
 * wheels against the fastest wheels of the other kind - disc against
 * regular - on rank 1's frame. Whether the two are close enough to say so is
 * the sentence's call (`app/utils/rideWhy.ts`); this is only what it says it
 * with.
 */
export interface WheelChoice {
  own: { wheelsetName: string, kind: WheelKind }
  other: { wheelsetName: string, kind: WheelKind }
  /** How much later the other wheels finish, s. Never negative: when they are quicker there is no choice to describe, and this is left out. */
  gapSec: number
  /** How much heavier rank 1's own wheels make the bike, kg; negative when they are lighter. */
  massDeltaKg: number
}
