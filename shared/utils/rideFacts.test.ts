import { describe, expect, it } from 'vitest'
import type { SurfaceEstimate } from '../types/catalog'
import { climbCountFact, distanceLabel, namedClimbCounts, surfaceCoverageLine, surfaceCoverageNote, surfaceShareFacts, surfaceSplit } from './rideFacts'

function surface(overrides: Partial<SurfaceEstimate>): SurfaceEstimate {
  return { road: 100, gravel: 0, cobble: 0, confidence: 'heuristic', ...overrides }
}

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
    expect(climbCountFact({ climbs: 4, sprints: 1 })).toEqual({ value: '4', label: 'named climbs, 1 sprint' })
    expect(climbCountFact({ climbs: 0, sprints: 2 })).toEqual({ value: '2', label: 'sprints' })
    expect(climbCountFact({ climbs: 0, sprints: 0 })).toBeUndefined()
  })
})

describe('namedClimbCounts', () => {
  it('counts each named climb and sprint once, however often the course passes it', () => {
    const kom = { slug: 'kom' }
    expect(namedClimbCounts({ climbs: [kom, kom, { slug: 'radio' }], sprints: [{ slug: 'sprint' }] })).toEqual({ climbs: 2, sprints: 1 })
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

describe('surfaceCoverageLine', () => {
  it('distinguishes mapped positions from a measured mix without them', () => {
    expect(surfaceCoverageLine(surface({ confidence: 'measured', segments: [{ fromKm: 0, toKm: 1, type: 'tarmac' }] }))).toBe('Mapped surfaces')
    expect(surfaceCoverageLine(surface({ confidence: 'measured' }))).toBe('Measured surface mix; locations unavailable')
  })

  it('names curated, unverified and heuristic coverage honestly', () => {
    expect(surfaceCoverageLine(surface({ confidence: 'curated' }))).toBe('Curated surface estimate; locations unavailable')
    expect(surfaceCoverageLine(surface({ confidence: 'unverified' }))).toBe('Surface unverified; road assumed by model')
    expect(surfaceCoverageLine(surface({ confidence: 'heuristic' }))).toBe('Surface unmapped; road assumed by model')
  })
})

describe('surfaceCoverageNote', () => {
  it('says nothing about mapped surfaces, and gives the rest as a sentence', () => {
    expect(surfaceCoverageNote(surface({ confidence: 'measured', segments: [{ fromKm: 0, toKm: 1, type: 'tarmac' }] }))).toBeUndefined()
    expect(surfaceCoverageNote(surface({ confidence: 'curated' }))).toBe('Curated surface estimate; locations unavailable.')
  })
})
