import { describe, expect, it } from 'vitest'
import { climbCountFact, surfaceShareFacts } from './rideFacts'

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
