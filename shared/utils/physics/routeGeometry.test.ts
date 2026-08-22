import { describe, expect, it } from 'vitest'
import { getRouteBySlug } from '../catalog'
import { geometryForRouteLaps } from './routeGeometry'

const route = (slug: string) => {
  const found = getRouteBySlug(slug)
  expect(found, `no route "${slug}" in the catalog`).toBeDefined()
  return found!
}

describe('geometryForRouteLaps', () => {
  it('always spans lead-in + laps x lap exactly, with monotone points', () => {
    for (const slug of ['road-to-sky', 'lutscher', 'tour-of-fire-and-ice', 'glyph-heights']) {
      for (const laps of [1, 3]) {
        const r = route(slug)
        const g = geometryForRouteLaps(r, laps)
        const expectedM = ((r.leadInDistance ?? 0) + r.distance * laps) * 1000
        expect(g.totalDistanceM, `${slug} x${laps}`).toBeCloseTo(expectedM, 6)
        expect(g.points[g.points.length - 1]!.distanceM).toBeCloseTo(expectedM, 6)
        for (let i = 1; i < g.points.length; i++) {
          expect(g.points[i]!.distanceM, `${slug} x${laps} point ${i}`).toBeGreaterThanOrEqual(g.points[i - 1]!.distanceM)
        }
      }
    }
  })

  it('reproduces per-lap ascent close to the official elevation on measured routes', () => {
    // The old ride-relative split carved the lap's own first `leadIn` km off
    // as "the lead-in" and stretched the remainder, losing real ascent
    // (glyph-heights modelled 524m of its official 588m before the fix).
    for (const slug of ['tour-of-fire-and-ice', 'glyph-heights', 'accelerate-to-elevate']) {
      const r = route(slug)
      const g = geometryForRouteLaps(r, 1)
      let ascent = 0
      for (let i = 1; i < g.points.length; i++) {
        const delta = g.points[i]!.elevationM - g.points[i - 1]!.elevationM
        if (delta > 0) ascent += delta
      }
      const expected = (r.leadInElevation ?? 0) + r.elevation
      expect(Math.abs(ascent - expected) / expected, `${slug}: ${ascent.toFixed(0)}m vs ${expected.toFixed(0)}m`).toBeLessThan(0.05)
    }
  })

  it('uses the measured lead-in shape where the trace covered it (lutscher)', () => {
    const r = route('lutscher')
    expect(r.terrain.leadInElevationProfile?.length ?? 0).toBeGreaterThan(2)
    const g = geometryForRouteLaps(r, 1)
    const leadInM = (r.leadInDistance ?? 0) * 1000
    // A measured lead-in produces many points inside the lead-in span; the
    // synthetic fallback would produce exactly one (a straight line).
    const leadInPoints = g.points.filter(p => p.distanceM > 0 && p.distanceM < leadInM)
    expect(leadInPoints.length).toBeGreaterThan(2)
  })

  it('keeps the lap surface segments inside each lap span', () => {
    const r = route('lutscher')
    const g = geometryForRouteLaps(r, 2)
    const leadInM = (r.leadInDistance ?? 0) * 1000
    const lapM = r.distance * 1000
    for (const segment of g.surfaceSegments) {
      expect(segment.toM).toBeGreaterThan(segment.fromM)
      expect(segment.toM).toBeLessThanOrEqual(leadInM + 2 * lapM + 1)
    }
    // The lead-in span is covered by lead-in segments (measured for lutscher).
    expect(g.surfaceSegments[0]!.fromM).toBe(0)
    expect(g.surfaceSegments.some(s => s.fromM >= leadInM)).toBe(true)
  })
})
