import { describe, expect, it } from 'vitest'
import { discoveryCountLine } from './discoveryCounts'

describe('discoveryCountLine', () => {
  it('counts one noun, singular at one', () => {
    expect(discoveryCountLine([{ value: 24, noun: 'route' }])).toBe('24 routes found')
    expect(discoveryCountLine([{ value: 1, noun: 'route' }])).toBe('1 route found')
  })

  it('joins two nouns with "and", keeping a zero', () => {
    expect(discoveryCountLine([{ value: 12, noun: 'climb' }, { value: 0, noun: 'sprint' }])).toBe('12 climbs and 0 sprints found')
  })
})
