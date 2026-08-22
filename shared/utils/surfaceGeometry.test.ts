import { describe, expect, it } from 'vitest'
import type { SurfaceSegment } from '../types/catalog'
import { sliceSurfaceSegments } from './surfaceGeometry'

const MEASURED: SurfaceSegment[] = [
  { fromKm: 0, toKm: 1, type: 'tarmac' },
  { fromKm: 1, toKm: 1.5, type: 'dirt' },
  { fromKm: 1.5, toKm: 3, type: 'tarmac' }
]

describe('sliceSurfaceSegments', () => {
  it('clips to the requested km range and converts to offset metres', () => {
    const sliced = sliceSurfaceSegments(MEASURED, 0.5, 1.2, 'tarmac')
    expect(sliced).toEqual([
      { fromM: 0, toM: 500, surface: 'tarmac' },
      { fromM: 500, toM: 700, surface: 'dirt' }
    ])
  })

  it('applies the offset to every output segment', () => {
    const sliced = sliceSurfaceSegments(MEASURED, 1, 2, 'tarmac', 5000)
    expect(sliced[0]).toEqual({ fromM: 5000, toM: 5500, surface: 'dirt' })
    expect(sliced[1]).toEqual({ fromM: 5500, toM: 6000, surface: 'tarmac' })
  })

  it('falls back to one covering segment when there is no measured data in range', () => {
    expect(sliceSurfaceSegments(undefined, 0, 2, 'gravel', 100)).toEqual([{ fromM: 100, toM: 2100, surface: 'gravel' }])
    expect(sliceSurfaceSegments(MEASURED, 5, 7, 'gravel')).toEqual([{ fromM: 0, toM: 2000, surface: 'gravel' }])
  })
})
