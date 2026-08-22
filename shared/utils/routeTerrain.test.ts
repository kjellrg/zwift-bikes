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

  it('has ordered, LAP-relative surface segments (the single alignment convention)', () => {
    const bad = routes.filter((r) => {
      const segments = r.surface.segments
      if (!segments?.length) return false
      let previousFrom = 0
      for (const segment of segments) {
        if (!finite(segment.fromKm) || !finite(segment.toKm)) return true
        if (segment.fromKm < previousFrom - 0.01 || segment.toKm < segment.fromKm) return true
        previousFrom = segment.fromKm
      }
      // Every measured trace is normalized to lap-relative at generation time
      // (issue #126 - `scripts/route-surfaces/normalize.mjs` splits traces
      // that covered the lead-in into `leadInSegments` + lap). So coverage
      // must end near the LAP distance alone - no lead-in allowance - with
      // slack matching the normalizer's own tolerance: lead-ins at or below
      // it are deliberately left unsplit (macaron carries its 0.17km one),
      // and GPS noise runs a few percent either way (three-sisters-rev is
      // ~4.6% long).
      const end = segments[segments.length - 1]!.toKm
      const slack = Math.max(0.3, r.distance * 0.05)
      return end < r.distance * 0.85 || end > r.distance + slack
    }).map(r => r.slug)
    expect(bad).toEqual([])
  })

  it('has lead-in surface/elevation data that is rebased and spans the lead-in when present', () => {
    const bad = routes.filter((r) => {
      const leadInKm = r.leadInDistance ?? 0
      const leadInSegments = r.surface.leadInSegments
      const leadInProfile = r.terrain.leadInElevationProfile
      if (!leadInSegments && !leadInProfile) return false
      if (leadInKm <= 0) return true
      if (leadInSegments) {
        if (leadInSegments[0]!.fromKm < -0.01) return true
        const end = leadInSegments[leadInSegments.length - 1]!.toKm
        if (Math.abs(end - leadInKm) > Math.max(0.1, leadInKm * 0.05)) return true
      }
      if (leadInProfile) {
        if (leadInProfile.length < 2) return true
        if (Math.abs(leadInProfile[0]!.distanceM) > 1 || Math.abs(leadInProfile[0]!.elevationM) > 1) return true
        for (let i = 1; i < leadInProfile.length; i++) {
          if (!finite(leadInProfile[i]!.distanceM) || !finite(leadInProfile[i]!.elevationM)) return true
          if (leadInProfile[i]!.distanceM < leadInProfile[i - 1]!.distanceM) return true
        }
      }
      return false
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

  it('keeps per-lap climbs within the lap (the placement-frame decision holds)', () => {
    // A perLap climb's positions are lap-relative, so its end can't sit
    // meaningfully past the lap distance - that was exactly the symptom of
    // reading ride-relative positions with the wrong frame (issue #126).
    const bad = routes.filter(r => r.terrain.climbs.some(climb =>
      climb.perLap && climb.toKm > r.distance + Math.max(0.3, r.distance * 0.05)
    )).map(r => r.slug)
    expect(bad).toEqual([])
  })

  it('has no implausibly flat measured profiles (bad altitude streams are dropped at generation)', () => {
    // 16 community Strava segments carried flat/garbage altitude streams -
    // routes with up to 262m of official climbing modelled as 0m. The
    // normalizer discards those profiles (synthesis fallback applies); this
    // mirrors that guard so a regeneration can't smuggle one back in.
    const bad = routes.filter((r) => {
      const profile = r.terrain.elevationProfile
      if (!profile || profile.length < 2 || r.elevation <= 20) return false
      let ascent = 0
      for (let i = 1; i < profile.length; i++) {
        const delta = profile[i]!.elevationM - profile[i - 1]!.elevationM
        if (delta > 0) ascent += delta
      }
      return ascent < r.elevation * 0.25
    }).map(r => r.slug)
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
