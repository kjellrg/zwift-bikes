import { describe, expect, it } from 'vitest'
import type { SurfaceSegment } from '../types/catalog'
import { sliceSurfaceSegments, surfaceSegmentsFromComposition } from './surfaceGeometry'

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

describe('surfaceSegmentsFromComposition (issue #172)', () => {
  it('gives every surface in the mix its share of the distance, biggest first', () => {
    expect(surfaceSegmentsFromComposition({ tarmac: 70, cobbles: 30 }, 'tarmac', 10000)).toEqual([
      { fromM: 0, toM: 7000, surface: 'tarmac' },
      { fromM: 7000, toM: 10000, surface: 'cobbles' }
    ])
  })

  it('ends exactly on the span, leaving no gap for the surface lookup to fall into', () => {
    const segments = surfaceSegmentsFromComposition({ dirt: 33.3, tarmac: 33.3, cobbles: 33.3 }, 'tarmac', 9999, 500)
    expect(segments[0]!.fromM).toBe(500)
    expect(segments[segments.length - 1]!.toM).toBe(10499)
    for (let i = 1; i < segments.length; i++) expect(segments[i]!.fromM).toBe(segments[i - 1]!.toM)
  })

  it('normalizes a composition that does not sum to 100', () => {
    const segments = surfaceSegmentsFromComposition({ tarmac: 1, dirt: 3 }, 'tarmac', 8000)
    expect(segments).toEqual([
      { fromM: 0, toM: 6000, surface: 'dirt' },
      { fromM: 6000, toM: 8000, surface: 'tarmac' }
    ])
  })

  it('falls back to one block of the given surface when nothing is known', () => {
    expect(surfaceSegmentsFromComposition(undefined, 'dirt', 5000)).toEqual([{ fromM: 0, toM: 5000, surface: 'dirt' }])
    expect(surfaceSegmentsFromComposition({}, 'tarmac', 5000)).toEqual([{ fromM: 0, toM: 5000, surface: 'tarmac' }])
  })

  it('drops surfaces with no share rather than emitting zero-length blocks', () => {
    expect(surfaceSegmentsFromComposition({ tarmac: 100, cobbles: 0 }, 'tarmac', 5000))
      .toEqual([{ fromM: 0, toM: 5000, surface: 'tarmac' }])
  })
})
