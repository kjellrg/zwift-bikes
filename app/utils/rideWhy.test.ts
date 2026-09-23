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

describe('aeroShare', () => {
  it('splits aerodynamics against weight, and calls an empty split even', () => {
    expect(aeroShare({ aero: 0.75, climb: 0.25 })).toBe(0.75)
    expect(aeroShare({ aero: 0, climb: 0 })).toBe(0.5)
  })
})
