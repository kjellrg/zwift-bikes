import { describe, expect, it } from 'vitest'
import { discoveryCountLine, worldCountLine } from './discoveryCounts'

describe('discoveryCountLine', () => {
  it('counts one noun, singular at one', () => {
    expect(discoveryCountLine([{ value: 24, noun: 'route' }])).toBe('24 routes found')
    expect(discoveryCountLine([{ value: 1, noun: 'route' }])).toBe('1 route found')
  })

  it('joins two nouns with "and", keeping a zero', () => {
    expect(discoveryCountLine([{ value: 12, noun: 'climb' }, { value: 0, noun: 'sprint' }])).toBe('12 climbs and 0 sprints found')
  })
})

describe('worldCountLine', () => {
  it('counts the routes, then the climbs and sprints together', () => {
    expect(worldCountLine({ routes: 110, climbs: 12, sprints: 16 })).toBe('110 routes, 28 climbs and sprints')
  })

  it('names the one kind of segment a world has, singular at one', () => {
    expect(worldCountLine({ routes: 1, climbs: 1, sprints: 0 })).toBe('1 route, 1 climb')
    expect(worldCountLine({ routes: 2, climbs: 0, sprints: 2 })).toBe('2 routes, 2 sprints')
  })

  it('leaves the segments out of a world that has none', () => {
    expect(worldCountLine({ routes: 7, climbs: 0, sprints: 0 })).toBe('7 routes')
  })
})
