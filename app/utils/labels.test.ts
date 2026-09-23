import { describe, expect, it } from 'vitest'
import type { SurfaceEstimate } from '../../shared/types/catalog'
import { formatSurfaceTimePenalty } from './labels'

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
