import { describe, expect, it } from 'vitest'
import type { SurfaceEstimate } from '../../shared/types/catalog'
import { limitedCourseDataNote, surfaceCoverageLine } from './rideCoverage'

function surface(overrides: Partial<SurfaceEstimate>): SurfaceEstimate {
  return { road: 100, gravel: 0, cobble: 0, confidence: 'heuristic', ...overrides }
}

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

describe('limitedCourseDataNote', () => {
  it('says which positioned data is missing, or nothing when both are present', () => {
    expect(limitedCourseDataNote({ hasElevationProfile: true, hasSurfaceLocations: true })).toBeUndefined()
    expect(limitedCourseDataNote({ hasElevationProfile: false, hasSurfaceLocations: true })).toBe('Limited route data: elevation profile unavailable.')
    expect(limitedCourseDataNote({ hasElevationProfile: true, hasSurfaceLocations: false })).toBe('Limited route data: surface locations unavailable.')
    expect(limitedCourseDataNote({ hasElevationProfile: false, hasSurfaceLocations: false })).toBe('Limited route data: elevation and surface locations unavailable.')
  })
})
