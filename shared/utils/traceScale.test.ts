import { describe, expect, it } from 'vitest'
import type { SurfaceSegment } from '../types/catalog'
import { getRoutesWithMeta } from './catalog'
import { measuredTraceScale, rescaleElevationProfile, rescaleSurfaceSegments } from './traceScale'

describe('measuredTraceScale', () => {
  it('maps trace km onto official km', () => {
    expect(measuredTraceScale(4.59, 5.01)).toBeCloseTo(1.0915, 4)
    expect(measuredTraceScale(5, 5)).toBe(1)
  })

  it('refuses to stretch a trace that cannot be the same road', () => {
    // A trace half or double the official length is a different segment, not
    // a badly cut one; stretching it would invent positions.
    expect(measuredTraceScale(10, 5)).toBe(1)
    expect(measuredTraceScale(5, 10)).toBe(1)
  })

  it('is 1 for missing or degenerate distances', () => {
    expect(measuredTraceScale(undefined, 5)).toBe(1)
    expect(measuredTraceScale(5, undefined)).toBe(1)
    expect(measuredTraceScale(0, 5)).toBe(1)
  })
})

describe('rescaleSurfaceSegments', () => {
  const segments: SurfaceSegment[] = [
    { fromKm: 0, toKm: 2, type: 'tarmac' },
    { fromKm: 2, toKm: 4.59, type: 'cobbles' }
  ]

  it('lands the last segment exactly on the official distance', () => {
    const rescaled = rescaleSurfaceSegments(segments, 5.01)!
    expect(rescaled[rescaled.length - 1]!.toKm).toBeCloseTo(5.01, 9)
    expect(rescaled[0]!.fromKm).toBe(0)
    expect(rescaled[0]!.toKm).toBeCloseTo(2 * (5.01 / 4.59), 9)
  })

  it('keeps each surface\'s share of the lap - a uniform scale moves no percentage', () => {
    const share = (segs: SurfaceSegment[]) => {
      const total = segs[segs.length - 1]!.toKm
      return (segs[1]!.toKm - segs[1]!.fromKm) / total
    }
    expect(share(rescaleSurfaceSegments(segments, 5.01)!)).toBeCloseTo(share(segments), 12)
  })

  it('returns the input untouched when there is nothing to scale', () => {
    expect(rescaleSurfaceSegments(undefined, 5)).toBeUndefined()
    expect(rescaleSurfaceSegments([], 5)).toEqual([])
    expect(rescaleSurfaceSegments(segments, 4.59)).toBe(segments)
  })
})

describe('rescaleElevationProfile', () => {
  const profile = [
    { distanceM: 0, elevationM: 0 },
    { distanceM: 2000, elevationM: 100 },
    { distanceM: 4590, elevationM: 40 }
  ]

  it('moves distances and never elevations', () => {
    const rescaled = rescaleElevationProfile(profile, 5.01)!
    expect(rescaled[rescaled.length - 1]!.distanceM).toBeCloseTo(5010, 6)
    expect(rescaled.map(p => p.elevationM)).toEqual([0, 100, 40])
  })
})

describe('measured routes read in official kilometres (issue #171)', () => {
  // The defect was that only ONE of the two measured arrays was rescaled, so
  // a route's surfaces and its road shape described different distances. The
  // guarantee is now positional, checked on the real catalog.
  const measured = getRoutesWithMeta().filter(route => route.surface.confidence === 'measured')

  it('covers the catalog', () => {
    expect(measured.length).toBeGreaterThan(250)
  })

  it('ends every lap\'s surface segments exactly on the official lap distance', () => {
    for (const route of measured) {
      const segments = route.surface.segments
      if (!segments?.length) continue
      expect(segments[segments.length - 1]!.toKm, route.slug).toBeCloseTo(route.distance, 6)
      expect(segments[0]!.fromKm, route.slug).toBe(0)
    }
  })

  it('ends every measured elevation profile on the same distance as the surfaces', () => {
    for (const route of measured) {
      const profile = route.terrain.elevationProfile
      const segments = route.surface.segments
      if (!profile?.length || !segments?.length) continue
      expect(profile[profile.length - 1]!.distanceM / 1000, route.slug).toBeCloseTo(segments[segments.length - 1]!.toKm, 6)
    }
  })

  it('leaves no gap between consecutive surface segments for the surface lookup to fall into', () => {
    for (const route of measured) {
      for (const segments of [route.surface.segments, route.surface.leadInSegments]) {
        if (!segments?.length) continue
        for (let i = 1; i < segments.length; i++) {
          expect(segments[i]!.fromKm, `${route.slug} segment ${i}`).toBeCloseTo(segments[i - 1]!.toKm, 9)
        }
      }
    }
  })
})
