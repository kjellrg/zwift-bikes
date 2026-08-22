import { describe, expect, it } from 'vitest'
import { getRoutesWithMeta } from './catalog'
import { getAllSegmentSummaries } from './routeSegments'

/**
 * Structural sweep over the entire assembled route catalog - every route
 * zwift-data ships, joined with the generated surface data, curated tables
 * and lead-in overrides. This is the routes' counterpart to
 * `validate-speed-data.mjs`: a bad zwift-data release or a corrupt surface
 * regeneration should fail here, not render as NaN on a page.
 *
 * Deliberately invariants only - finiteness, ranges, ordering - never counts
 * or names, so a legitimate zwift-data update (new routes, new worlds, new
 * surfaces) passes without touching this file.
 */

const finite = (value: number) => Number.isFinite(value)

describe('every route in the assembled catalog', () => {
  const routes = getRoutesWithMeta()

  it('has at least one route and unique slugs (getRouteBySlug relies on this)', () => {
    expect(routes.length).toBeGreaterThan(0)
    const slugs = routes.map(r => r.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('has sane distance, elevation and lead-in figures', () => {
    const bad = routes.filter(r =>
      !finite(r.distance) || r.distance <= 0
      || !finite(r.elevation) || r.elevation < 0
      || (r.leadInDistance !== undefined && (!finite(r.leadInDistance) || r.leadInDistance < 0))
      || (r.leadInElevation !== undefined && (!finite(r.leadInElevation) || r.leadInElevation < 0))
    ).map(r => r.slug)
    expect(bad).toEqual([])
  })

  it('has finite terrain with weights the scorer can consume', () => {
    const bad = routes.filter((r) => {
      const { climbRatio, category, weights } = r.terrain
      return !finite(climbRatio) || climbRatio < 0
        || !['flat', 'rolling', 'hilly', 'mountainous'].includes(category)
        || !Object.values(weights).every(w => finite(w) && w >= 0)
        // computeTerrain splits exactly 1 between aero and climb.
        || Math.abs(weights.aero + weights.climb - 1) > 1e-9
    }).map(r => r.slug)
    expect(bad).toEqual([])
  })

  it('has surface percentages in range, summing to ~100', () => {
    const bad = routes.filter((r) => {
      const { road, gravel, cobble, confidence } = r.surface
      const inRange = (v: number) => finite(v) && v >= 0 && v <= 100
      return !inRange(road) || !inRange(gravel) || !inRange(cobble)
        || Math.abs(road + gravel + cobble - 100) > 1
        || !['measured', 'curated', 'unverified', 'heuristic'].includes(confidence)
    }).map(r => r.slug)
    expect(bad).toEqual([])
  })

  it('has detailed surface compositions that are non-negative and sum to ~100 when present', () => {
    const bad = routes.filter((r) => {
      const composition = r.surface.composition
      if (!composition) return false
      const values = Object.values(composition).map(v => v ?? 0)
      return !values.every(v => finite(v) && v >= 0)
        || Math.abs(values.reduce((sum, v) => sum + v, 0) - 100) > 1
    }).map(r => r.slug)
    expect(bad).toEqual([])
  })

  it('has ordered surface segments whose coverage ends near the lap (or lap + lead-in)', () => {
    const bad = routes.filter((r) => {
      const segments = r.surface.segments
      if (!segments?.length) return false
      let previousFrom = 0
      for (const segment of segments) {
        if (!finite(segment.fromKm) || !finite(segment.toKm)) return true
        if (segment.fromKm < previousFrom - 0.01 || segment.toKm < segment.fromKm) return true
        previousFrom = segment.fromKm
      }
      // The measured GPS traces are heterogeneous as of 2026-08: most cover
      // exactly one lap, ~21 routes (e.g. lutscher, ocean-blvd) cover
      // lead-in + lap, and a handful sit a few percent off either mark from
      // GPS noise (three-sisters-rev runs ~4.6% long). So the honest
      // structural bound is a band, not an exact figure: coverage must end
      // somewhere between most-of-a-lap and a full ride plus noise. Note the
      // pipeline itself currently assumes BOTH alignments in different
      // places (`splitMeasuredProfile` lead-in-inclusive, `lapSurfaceSegments`
      // lap-only) - tightening this band is the test-side half of resolving
      // that.
      const end = segments[segments.length - 1]!.toKm
      const slack = Math.max(0.1, r.distance * 0.05)
      return end < r.distance * 0.85 || end > r.distance + (r.leadInDistance ?? 0) + slack
    }).map(r => r.slug)
    expect(bad).toEqual([])
  })

  it('has climbs with finite, ordered placements and positive lengths', () => {
    const bad = routes.filter(r => r.terrain.climbs.some(climb =>
      !finite(climb.fromKm) || !finite(climb.toKm) || !finite(climb.lengthKm)
      || !finite(climb.elevationM) || !finite(climb.avgGradePercent)
      || climb.fromKm < 0 || climb.toKm < climb.fromKm || climb.lengthKm <= 0 || climb.elevationM < 0
    )).map(r => r.slug)
    expect(bad).toEqual([])
  })

  it('has monotonic, finite elevation profiles when measured', () => {
    const bad = routes.filter((r) => {
      const profile = r.terrain.elevationProfile
      if (!profile) return false
      if (profile.length < 2) return true
      if (Math.abs(profile[0]!.distanceM) > 1 || Math.abs(profile[0]!.elevationM) > 1) return true
      for (let i = 0; i < profile.length; i++) {
        if (!finite(profile[i]!.distanceM) || !finite(profile[i]!.elevationM)) return true
        if (i > 0 && profile[i]!.distanceM < profile[i - 1]!.distanceM) return true
      }
      return false
    }).map(r => r.slug)
    expect(bad).toEqual([])
  })

  it('resolves a world name for every route', () => {
    expect(routes.filter(r => !r.worldName).map(r => r.slug)).toEqual([])
  })
})

describe('every segment summary', () => {
  it('is finite, typed, and hosted by at least one route', () => {
    const summaries = getAllSegmentSummaries()
    expect(summaries.length).toBeGreaterThan(0)
    const bad = summaries.filter(s =>
      !s.slug || !s.name
      || !['climb', 'sprint'].includes(s.type)
      || !['positional', 'membership'].includes(s.placement)
      || !finite(s.lengthKm) || s.lengthKm <= 0
      || !finite(s.elevationM) || !finite(s.avgGradePercent)
      || s.hostRoutes.length === 0
    ).map(s => s.slug)
    expect(bad).toEqual([])
    const slugs = summaries.map(s => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})
