import { describe, expect, it } from 'vitest'
import { climbTradeNote } from './climbTrade'

const aethos = {
  frameName: 'Specialized Aethos S-Works',
  wheelsetName: 'Princeton Wake 6560 White',
  sameFrame: false,
  climbName: 'Innsbruck KOM',
  passes: 1,
  gainSec: 21.56,
  costSec: 7.49
}

describe('climbTradeNote', () => {
  it('states the trade with both numbers and hands the choice to the rider', () => {
    expect(climbTradeNote(aethos).text).toBe(
      'On the Innsbruck KOM the Specialized Aethos S-Works with Princeton Wake 6560 White wheels is 22 s quicker at your power, and 7.5 s slower over the race. '
      + 'If the Innsbruck KOM is where you lose the front group, ride the Specialized Aethos S-Works.'
    )
  })

  it('names a climb that is a place without an article, and a bike with fixed wheels by its frame', () => {
    expect(climbTradeNote({ ...aethos, frameName: 'Zwift Concept Z1', wheelsetName: undefined, climbName: 'Keith Hill' }).text).toBe(
      'On Keith Hill the Zwift Concept Z1 is 22 s quicker at your power, and 7.5 s slower over the race. '
      + 'If Keith Hill is where you lose the front group, ride the Zwift Concept Z1.'
    )
    expect(climbTradeNote({ ...aethos, climbName: 'The Grade KOM' }).text).toMatch(/^On The Grade KOM /)
  })

  it('offers rank 1\'s own frame on other wheels as a change of wheels', () => {
    expect(climbTradeNote({ ...aethos, frameName: 'Specialized Tarmac SL9', wheelsetName: 'SwissSide HADRON Ultimate 650', sameFrame: true, climbName: 'Keith Hill', gainSec: 5.5, costSec: 0.72 }).text).toBe(
      'On Keith Hill the same Specialized Tarmac SL9 on SwissSide HADRON Ultimate 650 wheels is 5.5 s quicker at your power, and 0.72 s slower over the race. '
      + 'If Keith Hill is where you lose the front group, fit the SwissSide HADRON Ultimate 650.'
    )
  })

  it('says which pass it measured when the climb is ridden more than once', () => {
    expect(climbTradeNote({ ...aethos, passes: 3, lapNumber: 3 }).text).toMatch(/^On the last pass of the Innsbruck KOM \(lap 3\) the /)
    expect(climbTradeNote({ ...aethos, passes: 2 }).text).toMatch(/^On the last pass of the Innsbruck KOM the /)
  })
})
