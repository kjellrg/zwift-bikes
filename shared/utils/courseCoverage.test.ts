import { describe, expect, it } from 'vitest'
import type { RouteWithMeta } from '../types/catalog'
import { courseCoverage, isMeasuredProfile, MEASURED_PROFILE_MIN_POINTS } from './courseCoverage'

const point = (distanceM: number, elevationM = 0) => ({ distanceM, elevationM })
const climb = (perLap: boolean) => ({ name: 'KOM', slug: 'kom', fromKm: 1, toKm: 2, lengthKm: 1, elevationM: 50, avgGradePercent: 5, perLap })

function course(overrides: { profile?: unknown[], leadInProfile?: unknown[], leadInKm?: number, segments?: unknown[], leadInSegments?: unknown[], climbs?: unknown[] } = {}) {
  return {
    leadInDistance: overrides.leadInKm,
    terrain: { elevationProfile: overrides.profile, leadInElevationProfile: overrides.leadInProfile, climbs: overrides.climbs ?? [], sprints: [] },
    surface: { segments: overrides.segments, leadInSegments: overrides.leadInSegments }
  } as unknown as RouteWithMeta
}

/**
 * The one "is this course measured?" rule (issue #319). Every reader - the
 * Course hero, the ranking's physics note, the MCP and Twin lines, the TTT
 * plan, the evidence line and the speed chart - reads it through the
 * resolved Ride; `server/utils/rankRide.test.ts` holds the whole catalog to
 * it on both sides.
 */
describe('courseCoverage', () => {
  it('reads a single elevation point as no profile at all, and two as a shape', () => {
    // One point is a start with no shape after it: nothing the dynamic
    // physics can put a grade change at a position on.
    expect(MEASURED_PROFILE_MIN_POINTS).toBe(2)
    expect(isMeasuredProfile(undefined)).toBe(false)
    expect(isMeasuredProfile([])).toBe(false)
    expect(isMeasuredProfile([point(0)])).toBe(false)
    expect(isMeasuredProfile([point(0), point(1000, 40)])).toBe(true)
    expect(courseCoverage(course({ profile: [point(0)] })).measuredLap).toBe(false)
    expect(courseCoverage(course({ profile: [point(0), point(1000, 40)] })).measuredLap).toBe(true)
  })

  it('reads a measured surface mix with no positioned stretches as no locations', () => {
    // A measured mix says how much cobble there is, never where it is.
    expect(courseCoverage(course({ segments: [] })).positionedSurfaces).toBe(false)
    expect(courseCoverage(course({ segments: [{ fromKm: 0, toKm: 1, type: 'cobbles' }] })).positionedSurfaces).toBe(true)
    expect(courseCoverage(course({ leadInKm: 2, leadInSegments: [{ fromKm: 0, toKm: 2, type: 'tarmac' }] })).positionedLeadInSurfaces).toBe(true)
  })

  it('measures a lead-in only where there is one, by its own profile', () => {
    const shape = [point(0), point(2000, 10)]
    expect(courseCoverage(course({ leadInKm: 2, leadInProfile: shape })).measuredLeadIn).toBe(true)
    expect(courseCoverage(course({ leadInKm: 2 })).measuredLeadIn).toBe(false)
    expect(courseCoverage(course({ leadInProfile: shape })).measuredLeadIn).toBe(false)
  })

  it('names what an unmeasured course is built from, as the geometry builder builds it', () => {
    const measured = [point(0), point(1000, 40)]
    expect(courseCoverage(course({ profile: measured, climbs: [climb(true)] })).approximation).toBe('measured')
    expect(courseCoverage(course({ climbs: [climb(true)] })).approximation).toBe('named-climbs')
    // A lead-in climb shapes the ride only where there is a lead-in to ride it in.
    expect(courseCoverage(course({ leadInKm: 3, climbs: [climb(false)] })).approximation).toBe('named-climbs')
    expect(courseCoverage(course({ climbs: [climb(false)] })).approximation).toBe('aggregate')
    expect(courseCoverage(course()).approximation).toBe('aggregate')
  })
})
