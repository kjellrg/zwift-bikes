import { describe, expect, it } from 'vitest'
import { RACE_DRAFT_SAVING } from '../../shared/utils/physics/draft'
import { aeroShare, whyThisWins } from './rideWhy'

const base = {
  rideName: 'Tempus Fugit',
  category: 'flat' as const,
  climbRatio: 1.5,
  frameName: 'Canyon Aeroad',
  frameStyle: 'aero' as const,
  frameCategory: 'standard' as const,
  draftMode: 'solo' as const
}

describe('whyThisWins', () => {
  it('says what the terrain usually rewards and credits a frame whose style it favours', () => {
    expect(whyThisWins({ ...base, weights: { aero: 1, climb: 0 } })).toBe(
      'Tempus Fugit is flat, with 1.5 m of climbing per kilometre, the kind of course where aerodynamics usually counts for far more than low weight. '
      + 'The Canyon Aeroad is an aero frame, the kind of frame that terrain favours.'
    )
  })

  it('never says the split decides the finish time, which the times are not simulated from', () => {
    for (const aero of [0, 0.3, 0.45, 0.5, 0.55, 0.7, 1]) {
      expect(whyThisWins({ ...base, weights: { aero, climb: 1 - aero } })).not.toMatch(/decides?|finish time/)
    }
  })

  it('names the frame\'s style without crediting it when the terrain points the other way', () => {
    const sentence = whyThisWins({ ...base, category: 'mountainous', climbRatio: 40, weights: { aero: 0, climb: 1 } })
    expect(sentence).toContain('the kind of course where low weight usually counts for far more than aerodynamics.')
    expect(sentence).toMatch(/The Canyon Aeroad is an aero frame\.$/)
  })

  it('names a time-trial frame as one, whatever its style', () => {
    expect(whyThisWins({ ...base, frameName: 'Canyon Speedmax CFR', frameCategory: 'tt', weights: { aero: 1, climb: 0 } }))
      .toMatch(/ The Canyon Speedmax CFR is a time-trial frame\.$/)
  })

  it('stops after the terrain when the frame has no style to name', () => {
    expect(whyThisWins({ ...base, frameStyle: undefined, weights: { aero: 0.5, climb: 0.5 } }))
      .toBe('Tempus Fugit is flat, with 1.5 m of climbing per kilometre, the kind of course where aerodynamics usually counts for about as much as low weight.')
  })

  it('says what a race bunch or a team time trial does to aero equipment, and nothing for a solo ride', () => {
    const weights = { aero: 1, climb: 0 }
    expect(whyThisWins({ ...base, weights, draftMode: 'race' }))
      .toMatch(/ In a race bunch the draft takes about a third of the air resistance off you on the flat, and less on the climbs, so aero equipment gains less here than riding alone\.$/)
    expect(whyThisWins({ ...base, weights, draftMode: 'ttt' }))
      .toMatch(/ In a team time trial you share the pulls, and aero equipment still counts most when you are on the front\.$/)
    expect(whyThisWins({ ...base, weights, draftMode: 'solo' })).not.toMatch(/draft|pulls/)
  })

  it('calls the race model\'s saving "about a third"', () => {
    expect(Math.abs(RACE_DRAFT_SAVING - 1 / 3)).toBeLessThan(0.05)
  })
})

describe('whyThisWins: the Wheel close call', () => {
  const weights = { aero: 1, climb: 0 }
  // Tempus Fugit in race drafting, measured on 2026-09-23 (issue #261).
  const discFaster = {
    own: { wheelsetName: 'Shimano C99/Disc', kind: 'disc' as const },
    other: { wheelsetName: 'Enve SES 8.9', kind: 'regular' as const },
    gapSec: 4.1,
    massDeltaKg: 0.2934
  }
  const regularFaster = {
    own: { wheelsetName: 'Princeton Wake 6560 White', kind: 'regular' as const },
    other: { wheelsetName: 'Shimano C99/Disc', kind: 'disc' as const },
    gapSec: 6.7,
    massDeltaKg: -0.86
  }
  const why = (overrides: Partial<Parameters<typeof whyThisWins>[0]>) =>
    whyThisWins({ ...base, weights, finishTimeSec: 1720.8, wheelChoice: discFaster, ...overrides })

  it('states the gap and the weight when the two kinds finish within 0.3% of each other', () => {
    expect(why({})).toMatch(/ Disc or regular wheels is a close call: the Shimano C99\/Disc is 4\.1 s faster than the Enve SES 8\.9, but 0\.29 kg heavier\.$/)
    expect(why({ wheelChoice: regularFaster, category: 'mountainous', finishTimeSec: 4435 }))
      .toMatch(/ Disc or regular wheels is a close call: the Princeton Wake 6560 White is 6\.7 s faster than the Shimano C99\/Disc here, and 0\.86 kg lighter\.$/)
    expect(why({ wheelChoice: { ...discFaster, gapSec: 0.33 } })).toContain('is 0.33 s faster than')
  })

  it('says nothing past 0.3% of the finish time, or with no other kind to weigh', () => {
    expect(why({ wheelChoice: { ...discFaster, gapSec: 1720.8 * 0.003 } })).toContain('close call')
    expect(why({ wheelChoice: { ...discFaster, gapSec: 1720.8 * 0.0031 } })).not.toContain('close call')
    expect(why({ wheelChoice: undefined })).not.toContain('close call')
    expect(why({ finishTimeSec: undefined })).not.toContain('close call')
  })

  it('advises the disc only in a race on flat terrain, where the weight rarely costs the group', () => {
    expect(why({ draftMode: 'race' })).toMatch(/heavier\. With this little climbing, the extra weight rarely costs you the group, so the disc is the pick as long as you stay in the draft, as these times assume\.$/)
    // A race on climbing terrain states the fact: the numbers for the climbs
    // are the Climb trade's to give. So do solo rides, TTTs, and a regular
    // wheel that wins on the flat.
    for (const overrides of [
      { draftMode: 'race' as const, category: 'rolling' as const },
      { draftMode: 'solo' as const },
      { draftMode: 'ttt' as const },
      { draftMode: 'race' as const, wheelChoice: { ...regularFaster, gapSec: 3 } },
      // A disc that is somehow the lighter of the two has no extra weight to excuse.
      { draftMode: 'race' as const, wheelChoice: { ...discFaster, massDeltaKg: -0.12 } }
    ]) {
      expect(why(overrides)).toMatch(/(heavier|lighter)\.$/)
    }
  })
})

describe('aeroShare', () => {
  it('splits aerodynamics against weight, and calls an empty split even', () => {
    expect(aeroShare({ aero: 0.75, climb: 0.25 })).toBe(0.75)
    expect(aeroShare({ aero: 0, climb: 0 })).toBe(0.5)
  })
})
