import { describe, expect, it } from 'vitest'
import type { SurfaceEstimate } from '../../shared/types/catalog'
import { limitedCourseDataNote, surfaceCoverageLine, surfaceNamesLine } from './rideBriefing'

function surface(overrides: Partial<SurfaceEstimate>): SurfaceEstimate {
  return { road: 100, gravel: 0, cobble: 0, confidence: 'heuristic', ...overrides }
}

describe('surfaceNamesLine', () => {
  it('lists the surfaces present, largest share first, by their display names', () => {
    expect(surfaceNamesLine({ tarmac: 95.3, cobbles: 2.6, wood: 2.1 })).toBe('Tarmac / Cobbles / Wood')
    expect(surfaceNamesLine({ wood: 8.7, tarmac: 87.1, dirt: 2.0 })).toBe('Tarmac / Wood / Dirt')
  })

  it('drops zero shares and yields nothing without a composition', () => {
    expect(surfaceNamesLine({ tarmac: 100, gravel: 0 })).toBe('Tarmac')
    expect(surfaceNamesLine(undefined)).toBeUndefined()
    expect(surfaceNamesLine({})).toBeUndefined()
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

describe('limitedCourseDataNote', () => {
  it('says which positioned data is missing, or nothing when both are present', () => {
    expect(limitedCourseDataNote({ hasElevationProfile: true, hasSurfaceLocations: true })).toBeUndefined()
    expect(limitedCourseDataNote({ hasElevationProfile: false, hasSurfaceLocations: true })).toBe('Limited route data: elevation profile unavailable.')
    expect(limitedCourseDataNote({ hasElevationProfile: true, hasSurfaceLocations: false })).toBe('Limited route data: surface locations unavailable.')
    expect(limitedCourseDataNote({ hasElevationProfile: false, hasSurfaceLocations: false })).toBe('Limited route data: elevation and surface locations unavailable.')
  })
})
