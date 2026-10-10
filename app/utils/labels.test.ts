import { describe, expect, it } from 'vitest'
import type { SurfaceEstimate } from '../../shared/types/catalog'
import { formatGapText, formatSurfaceTimePenalty, routeSurfaceWords } from './labels'

const rough: SurfaceEstimate = { road: 60, gravel: 40, cobble: 0, confidence: 'measured' }

describe('formatSurfaceTimePenalty', () => {
  it('says seconds under a minute and minutes from one up, deciding on the rounded time', () => {
    expect(formatSurfaceTimePenalty(rough, 42.4)).toBe('Rough surfaces cost this setup about 42 seconds here')
    expect(formatSurfaceTimePenalty(rough, 59.7)).toBe('Rough surfaces cost this setup about 1:00 minutes here')
    expect(formatSurfaceTimePenalty(rough, 131)).toBe('Rough surfaces cost this setup about 2:11 minutes here')
  })

  it('reads an hour and more as hours, not as minutes', () => {
    expect(formatSurfaceTimePenalty(rough, 3725)).toBe('Rough surfaces cost this setup about 1:02:05 hours here')
  })

  it('says nothing on an all-tarmac route or with no time lost', () => {
    expect(formatSurfaceTimePenalty({ ...rough, road: 100, gravel: 0 }, 30)).toBeUndefined()
    expect(formatSurfaceTimePenalty(rough, 0)).toBeUndefined()
    expect(formatSurfaceTimePenalty(rough, undefined)).toBeUndefined()
  })
})

describe('formatGapText', () => {
  it('puts a thin space between a sub-minute gap and its unit', () => {
    expect(formatGapText(3.924)).toBe('+3.92\u2009s')
  })

  it('leaves minute gaps and the zero label alone', () => {
    expect(formatGapText(83)).toBe('+1:23')
    expect(formatGapText(0)).toBe('fastest')
    expect(formatGapText(0, 'Fastest in results')).toBe('Fastest in results')
  })
})

describe('routeSurfaceWords', () => {
  it('says what a World page row says about a route\'s surface: its gravel and cobble shares, rounded', () => {
    expect(routeSurfaceWords({ gravel: 0, cobble: 0 })).toBe('Road')
    expect(routeSurfaceWords({ gravel: 18.3, cobble: 0 })).toBe('18% gravel')
    expect(routeSurfaceWords({ gravel: 0, cobble: 4.7 })).toBe('5% cobbles')
    expect(routeSurfaceWords({ gravel: 12.5, cobble: 2.6 })).toBe('13% gravel, 3% cobbles')
  })

  it('calls a few metres of something a road, as the rounding does', () => {
    expect(routeSurfaceWords({ gravel: 0.4, cobble: 0.3 })).toBe('Road')
  })
})
