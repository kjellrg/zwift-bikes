import { describe, expect, it } from 'vitest'
import { limitedCourseDataNote } from './rideCoverage'

describe('limitedCourseDataNote', () => {
  it('says which positioned data is missing, or nothing when both are present', () => {
    expect(limitedCourseDataNote({ hasElevationProfile: true, hasSurfaceLocations: true })).toBeUndefined()
    expect(limitedCourseDataNote({ hasElevationProfile: false, hasSurfaceLocations: true })).toBe('Limited route data: elevation profile unavailable.')
    expect(limitedCourseDataNote({ hasElevationProfile: true, hasSurfaceLocations: false })).toBe('Limited route data: surface locations unavailable.')
    expect(limitedCourseDataNote({ hasElevationProfile: false, hasSurfaceLocations: false })).toBe('Limited route data: elevation and surface locations unavailable.')
  })
})
