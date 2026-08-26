import { describe, expect, it } from 'vitest'
import { sliceElevationProfile } from './elevationGeometry'
import type { RouteElevationPoint } from '../types/catalog'

// A 10 km profile climbing 10 m per km in 1 km steps - simple enough that
// every interpolated value is exact.
const rampProfile: RouteElevationPoint[] = Array.from({ length: 11 }, (_, i) => ({
  distanceM: i * 1000,
  elevationM: i * 10
}))

describe('sliceElevationProfile', () => {
  it('re-bases the slice to {0,0} and interpolates both boundaries', () => {
    const sliced = sliceElevationProfile(rampProfile, 2.5, 4.5)
    expect(sliced[0]).toEqual({ distanceM: 0, elevationM: 0 })
    const last = sliced[sliced.length - 1]!
    expect(last.distanceM).toBe(2000)
    // 2.5km on the ramp is 25m, 4.5km is 45m - the slice climbs 20m.
    expect(last.elevationM).toBeCloseTo(20)
    // Interior points survive with re-based coordinates.
    expect(sliced).toContainEqual({ distanceM: 500, elevationM: 5 })
    expect(sliced).toContainEqual({ distanceM: 1500, elevationM: 15 })
  })

  it('keeps grade intact across a slope change', () => {
    const profile: RouteElevationPoint[] = [
      { distanceM: 0, elevationM: 0 },
      { distanceM: 1000, elevationM: 0 }, // flat km
      { distanceM: 2000, elevationM: 100 } // 10% km
    ]
    const sliced = sliceElevationProfile(profile, 0.5, 1.5)
    expect(sliced).toEqual([
      { distanceM: 0, elevationM: 0 },
      { distanceM: 500, elevationM: 0 },
      { distanceM: 1000, elevationM: 50 }
    ])
  })

  it('returns [] for a missing or too-short profile', () => {
    expect(sliceElevationProfile(undefined, 0, 1)).toEqual([])
    expect(sliceElevationProfile([], 0, 1)).toEqual([])
    expect(sliceElevationProfile([{ distanceM: 0, elevationM: 0 }], 0, 1)).toEqual([])
  })

  it('returns [] for a degenerate or inverted span', () => {
    expect(sliceElevationProfile(rampProfile, 3, 3)).toEqual([])
    expect(sliceElevationProfile(rampProfile, 4, 3)).toEqual([])
  })

  it('returns [] when the span starts beyond the measured profile', () => {
    expect(sliceElevationProfile(rampProfile, 12, 14)).toEqual([])
  })

  it('tolerates a span slightly overrunning the profile, but not a truncated one', () => {
    // 9.5 -> 10.05 km: the profile ends at 10 km, covering ~91% of the span -
    // within the GPS-vs-official length disagreement tolerance.
    const slightOverrun = sliceElevationProfile(rampProfile, 9.5, 10.05)
    expect(slightOverrun.length).toBeGreaterThan(1)
    expect(slightOverrun[slightOverrun.length - 1]!.distanceM).toBe(500)
    // 8 -> 12 km: only half the span is measured - refusing beats silently
    // handing back half a segment.
    expect(sliceElevationProfile(rampProfile, 8, 12)).toEqual([])
  })
})
