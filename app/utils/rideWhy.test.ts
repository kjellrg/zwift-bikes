import { describe, expect, it } from 'vitest'
import { aeroShare, whyThisWins } from './rideWhy'

const base = { rideName: 'Tempus Fugit', category: 'flat' as const, climbRatio: 1.5, frameName: 'Canyon Aeroad', frameStyle: 'aero' as const }

describe('whyThisWins', () => {
  it('says how the model weighs the ride and credits a frame whose style that weighting favours', () => {
    expect(whyThisWins({ ...base, weights: { aero: 1, climb: 0 } })).toBe(
      'Tempus Fugit is flat, with 1.5 m of climbing per kilometre, so aerodynamics decide almost all of the finish time and weight very little. '
      + 'The Canyon Aeroad is an aero frame, the kind of frame that weighting favours.'
    )
  })

  it('names the frame\'s style without crediting it when the weighting points the other way', () => {
    const sentence = whyThisWins({ ...base, category: 'mountainous', climbRatio: 40, weights: { aero: 0, climb: 1 } })
    expect(sentence).toContain('weight on the climbs decides almost all of the finish time')
    expect(sentence).toMatch(/The Canyon Aeroad is an aero frame\.$/)
  })

  it('stops after the weighting when the frame has no style to name', () => {
    expect(whyThisWins({ ...base, frameStyle: undefined, weights: { aero: 0.5, climb: 0.5 } }))
      .toBe('Tempus Fugit is flat, with 1.5 m of climbing per kilometre, so aerodynamics and weight count about equally.')
  })
})

describe('aeroShare', () => {
  it('splits aerodynamics against weight, and calls an empty split even', () => {
    expect(aeroShare({ aero: 0.75, climb: 0.25 })).toBe(0.75)
    expect(aeroShare({ aero: 0, climb: 0 })).toBe(0.5)
  })
})
