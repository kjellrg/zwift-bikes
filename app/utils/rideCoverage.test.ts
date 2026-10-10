import { describe, expect, it } from 'vitest'
import { limitedCourseDataNote } from './rideCoverage'

describe('limitedCourseDataNote', () => {
  it('says which positioned data is missing, or nothing when both are present', () => {
    expect(limitedCourseDataNote({ measuredLap: true, positionedSurfaces: true })).toBeUndefined()
    expect(limitedCourseDataNote({ measuredLap: false, positionedSurfaces: true })).toBe('Limited route data: elevation profile unavailable.')
    expect(limitedCourseDataNote({ measuredLap: true, positionedSurfaces: false })).toBe('Limited route data: surface locations unavailable.')
    expect(limitedCourseDataNote({ measuredLap: false, positionedSurfaces: false })).toBe('Limited route data: elevation and surface locations unavailable.')
  })
})
