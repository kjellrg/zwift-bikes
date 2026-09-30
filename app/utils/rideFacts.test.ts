import { describe, expect, it } from 'vitest'
import { climbCountFact, distanceLabel, surfaceShareFacts, surfaceSplit } from './rideFacts'

describe('surfaceShareFacts', () => {
  it('sums each non-tarmac family and names its surfaces, largest first', () => {
    expect(surfaceShareFacts({ tarmac: 78.6, dirt: 18.3, wood: 2.3, cobbles: 0.7 })).toEqual([
      { value: '18.3%', label: 'dirt', family: 'dirt' },
      { value: '3.0%', label: 'wood and cobbles', family: 'rough' }
    ])
  })

  it('says nothing about an all-tarmac ride, or one with no mix', () => {
    expect(surfaceShareFacts({ tarmac: 100 })).toEqual([])
    expect(surfaceShareFacts(undefined)).toEqual([])
  })
})

describe('climbCountFact', () => {
  it('counts named climbs and sprints in words', () => {
    expect(climbCountFact(4, 1)).toEqual({ value: '4', label: 'named climbs, 1 sprint' })
    expect(climbCountFact(0, 2)).toEqual({ value: '2', label: 'sprints' })
    expect(climbCountFact(0, 0)).toBeUndefined()
  })
})

describe('distanceLabel', () => {
  it('folds the laps and the lead-in into the label', () => {
    expect(distanceLabel({ laps: 1, leadInKm: 3.7 })).toBe('with the 3.7 km lead-in')
    expect(distanceLabel({ laps: 3, leadInKm: 3.7 })).toBe('3 laps + 3.7 km lead-in')
    expect(distanceLabel({ laps: 1, leadInKm: 0 })).toBe('1 lap')
    expect(distanceLabel({ laps: 3, leadInKm: 0 })).toBe('3 laps')
  })

  it('leaves the laps out where the page has a cell for them', () => {
    expect(distanceLabel({ leadInKm: 3.7 })).toBe('with the 3.7 km lead-in')
    expect(distanceLabel({ leadInKm: 0 })).toBe('distance')
  })
})

describe('surfaceSplit', () => {
  it('gives tarmac, dirt and rough their shares, with the key that names them', () => {
    const split = surfaceSplit({ tarmac: 78.6, dirt: 18.3, wood: 2.3, cobbles: 0.7 })!
    expect(split.allTarmac).toBe(false)
    expect(split.parts.map(part => part.family)).toEqual(['tarmac', 'dirt', 'rough'])
    expect(split.key.map(entry => entry.text)).toEqual(['78.6% tarmac', '18.3% dirt', '3.0% wood and cobbles'])
  })

  it('reads an all-tarmac ride as that, and no mix as nothing', () => {
    expect(surfaceSplit({ tarmac: 100 })).toEqual({ parts: [], key: [], allTarmac: true })
    expect(surfaceSplit(undefined)).toBeUndefined()
    expect(surfaceSplit({})).toBeUndefined()
  })
})
