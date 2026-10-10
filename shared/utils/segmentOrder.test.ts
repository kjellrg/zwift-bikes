import { describe, expect, it } from 'vitest'
import { getAllSegmentSummaries } from './routeSegments'
import { climbsThenSprints } from './segmentOrder'

describe('climbsThenSprints', () => {
  it('orders a world\'s climbs by climbing gained and its sprints by name', () => {
    const { climbs, sprints } = climbsThenSprints(getAllSegmentSummaries().filter(segment => segment.world === 'watopia'))
    expect(climbs.every(segment => segment.type === 'climb')).toBe(true)
    expect(sprints.every(segment => segment.type === 'sprint')).toBe(true)
    expect(climbs[0]!.slug).toBe('alpe-du-zwift')
    const gains = climbs.map(segment => segment.measuredElevationM ?? segment.elevationM)
    expect(gains).toEqual([...gains].sort((a, b) => b - a))
    const names = sprints.map(segment => segment.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })
})
