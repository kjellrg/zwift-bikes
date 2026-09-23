import { formatGapSeconds } from './labels'

/**
 * The recommend endpoint's `climbTrade`, as the pages read it. Mirrors
 * `ClimbTrade` in `server/utils/climbTrade.ts`; `RecommendResponse` holds
 * the two together.
 */
export interface ClimbTrade {
  frameName: string
  wheelsetName?: string
  sameFrame: boolean
  climbName: string
  passes: number
  lapNumber?: number
  gainSec: number
  costSec: number
}

/**
 * A climb's name mid-sentence. Most are things - "the Innsbruck KOM", "the
 * Alpe du Zwift" - but a hill or a street is a place, and "On the Keith
 * Hill" is wrong; a name that already starts with its article keeps it.
 */
function climbPhrase(name: string): string {
  return /^The /.test(name) || / Hill$| St\.( Rev\.?)?$/.test(name) ? name : `the ${name}`
}

/**
 * The Climb trade note (see `CONTEXT.md`), from the recommend endpoint's
 * `climbTrade`. Every number and name comes from the response; the note
 * states the trade and leaves the choice to the rider, because only the
 * rider knows whether the climb is where they lose the front group.
 */
export function climbTradeNote(trade: ClimbTrade): { lead: string, text: string } {
  const climb = climbPhrase(trade.climbName)
  const where = trade.passes > 1
    ? `the last pass of ${climb}${trade.lapNumber ? ` (lap ${trade.lapNumber})` : ''}`
    : climb
  const setup = trade.sameFrame
    ? `the same ${trade.frameName} on ${trade.wheelsetName} wheels`
    : trade.wheelsetName ? `the ${trade.frameName} with ${trade.wheelsetName} wheels` : `the ${trade.frameName}`
  const choice = trade.sameFrame ? `fit the ${trade.wheelsetName}` : `ride the ${trade.frameName}`
  return {
    lead: 'Dropped on the climbs?',
    text: `On ${where} ${setup} is ${formatGapSeconds(trade.gainSec)} quicker at your power, and ${formatGapSeconds(trade.costSec)} slower over the race. `
      + `If ${climb} is where you lose the front group, ${choice}.`
  }
}
