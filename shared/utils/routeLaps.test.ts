import { describe, expect, it } from 'vitest'
import type { RouteWithMeta } from '../types/catalog'
import { clampLaps, computeRouteTotals, MAX_LAPS, MAX_TOTAL_DISTANCE_KM, maxLapsForRoute } from './routeLaps'

function testRoute(overrides: Partial<RouteWithMeta> & { distance: number, elevation: number }): RouteWithMeta {
  const climbRatio = overrides.elevation / overrides.distance
  return {
    world: 'watopia',
    worldName: 'Watopia',
    name: 'Test Route',
    slug: 'test-route',
    segments: [],
    segmentsOnRoute: [],
    sports: ['cycling'],
    eventOnly: false,
    levelLocked: false,
    lap: true,
    supportsTT: true,
    supportsMeetups: true,
    terrain: { climbRatio, category: 'flat', weights: { aero: 0.8, climb: 0.2, gravel: 0, cobble: 0 }, climbs: [] },
    surface: { road: 100, gravel: 0, cobble: 0, composition: { tarmac: 100 }, confidence: 'measured' },
    ...overrides
  }
}

describe('maxLapsForRoute', () => {
  it('is 1 for point-to-point routes', () => {
    expect(maxLapsForRoute(testRoute({ distance: 10, elevation: 50, lap: false }))).toBe(1)
  })

  it('is MAX_LAPS when the distance cap does not bind', () => {
    // 10km/lap: MAX_LAPS laps = 150km, inside the cap.
    expect(maxLapsForRoute(testRoute({ distance: 10, elevation: 50 }))).toBe(MAX_LAPS)
  })

  it('caps laps so the total ride fits MAX_TOTAL_DISTANCE_KM', () => {
    // ~Four Horsemen: 89.8km/lap. Cap allows 2 laps (179.6km), not 3 (269.4km).
    const long = testRoute({ distance: 89.8, elevation: 2100 })
    expect(maxLapsForRoute(long)).toBe(2)
    expect(computeRouteTotals(long, MAX_LAPS).distanceKm).toBeLessThanOrEqual(MAX_TOTAL_DISTANCE_KM)
  })

  it('counts the one-time lead-in against the cap', () => {
    // 66km/lap fits 3 laps bare (198km), only 2 with a 5km lead-in (203km > cap).
    expect(maxLapsForRoute(testRoute({ distance: 66, elevation: 100 }))).toBe(3)
    expect(maxLapsForRoute(testRoute({ distance: 66, elevation: 100, leadInDistance: 5, leadInElevation: 20 }))).toBe(2)
  })

  it('always allows one lap, even past the cap - the longest single-lap routes stay rideable', () => {
    expect(maxLapsForRoute(testRoute({ distance: MAX_TOTAL_DISTANCE_KM + 50, elevation: 1000 }))).toBe(1)
  })
})

describe('clampLaps', () => {
  it('honours the route maximum, not the flat MAX_LAPS', () => {
    const long = testRoute({ distance: 89.8, elevation: 2100 })
    expect(clampLaps(long, MAX_LAPS)).toBe(2)
    expect(clampLaps(long, 1)).toBe(1)
  })

  it('keeps its existing behaviour inside the cap', () => {
    const short = testRoute({ distance: 10, elevation: 50 })
    expect(clampLaps(short, 99)).toBe(MAX_LAPS)
    expect(clampLaps(short, undefined)).toBe(1)
    expect(clampLaps(short, Number.NaN)).toBe(1)
    expect(clampLaps(testRoute({ distance: 10, elevation: 50, lap: false }), 5)).toBe(1)
  })
})
