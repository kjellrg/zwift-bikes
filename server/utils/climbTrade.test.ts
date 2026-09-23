import { describe, expect, it } from 'vitest'
import { pickClimbTrade } from './climbTrade'

// Measured on the live API on 2026-09-23, 75 kg at 240 W in race drafting on
// Innsbruck KOM After Party (issue #258).
const kom = { name: 'Innsbruck KOM', slug: 'innsbruck-kom', rideFromKm: 29.8 }
const tron = { finishSec: 4249.7, climbSec: [1545.4] }
const aethos = { frameName: 'Specialized Aethos S-Works', wheelsetName: 'Princeton Wake 6560 White', sameFrame: false, timing: { finishSec: 4257.4, climbSec: [1524.1] } }

describe('pickClimbTrade', () => {
  it('names the setup that is quicker over the climb for a small cost over the Ride', () => {
    expect(pickClimbTrade([kom], tron, [aethos])).toEqual({
      frameName: 'Specialized Aethos S-Works',
      wheelsetName: 'Princeton Wake 6560 White',
      sameFrame: false,
      climbName: 'Innsbruck KOM',
      passes: 1,
      lapNumber: undefined,
      gainSec: expect.closeTo(21.3, 5),
      costSec: expect.closeTo(7.7, 5)
    })
  })

  it('says nothing under 5 s gained on the climb or over 30 s lost over the Ride', () => {
    const withTiming = (finishSec: number, climbSec: number) => ({ ...aethos, timing: { finishSec, climbSec: [climbSec] } })
    const rank1 = { finishSec: 3600, climbSec: [1200] }
    expect(pickClimbTrade([kom], rank1, [withTiming(3610, 1195)])?.gainSec).toBe(5)
    expect(pickClimbTrade([kom], rank1, [withTiming(3610, 1195.1)])).toBeUndefined()
    expect(pickClimbTrade([kom], rank1, [withTiming(3630, 1180)])?.costSec).toBe(30)
    expect(pickClimbTrade([kom], rank1, [withTiming(3630.1, 1180)])).toBeUndefined()
  })

  it('never names a setup that is quicker over the whole Ride - that is not a trade', () => {
    expect(pickClimbTrade([kom], tron, [{ ...aethos, timing: { finishSec: 4240, climbSec: [1500] } }])).toBeUndefined()
  })

  it('counts the last pass of a climb ridden more than once, and says which lap it is on', () => {
    const passes = [
      { ...kom, rideFromKm: 3 },
      { ...kom, rideFromKm: 17, lapNumber: 1 },
      { ...kom, rideFromKm: 31, lapNumber: 2 }
    ]
    const rank1 = { finishSec: 5000, climbSec: [1500, 1480, 1490] }
    const quickEarly = { ...aethos, timing: { finishSec: 5010, climbSec: [1480, 1460, 1488] } }
    expect(pickClimbTrade(passes, rank1, [quickEarly])).toBeUndefined()
    const quickLast = { ...aethos, timing: { finishSec: 5010, climbSec: [1499, 1479, 1470] } }
    expect(pickClimbTrade(passes, rank1, [quickLast])).toMatchObject({ passes: 3, lapNumber: 2, gainSec: 20 })
  })

  it('names one setup at most: the largest gain, then the smaller cost', () => {
    const climbs = [kom, { name: 'Other climb', slug: 'other', rideFromKm: 10 }]
    const rank1 = { finishSec: 3600, climbSec: [1200, 300] }
    const candidate = (frameName: string, finishSec: number, climbSec: number[]) => ({ frameName, sameFrame: false, timing: { finishSec, climbSec } })
    expect(pickClimbTrade(climbs, rank1, [
      candidate('A', 3610, [1190, 300]),
      candidate('B', 3620, [1200, 288]),
      candidate('C', 3605, [1188, 300])
    ])).toMatchObject({ frameName: 'C', climbName: 'Innsbruck KOM', gainSec: 12, costSec: 5 })
    expect(pickClimbTrade(climbs, rank1, [
      candidate('A', 3610, [1190, 300]),
      candidate('B', 3620, [1200, 285])
    ])).toMatchObject({ frameName: 'B', climbName: 'Other climb', gainSec: 15 })
  })

  it('has nothing to say on a Ride with no named climbs', () => {
    expect(pickClimbTrade([], { finishSec: 3600, climbSec: [] }, [aethos])).toBeUndefined()
  })
})
