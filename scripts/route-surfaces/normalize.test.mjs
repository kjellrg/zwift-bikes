import { describe, expect, it } from 'vitest'
import { normalizeRouteSurfaceEntry } from './normalize.mjs'

// A lap-aligned trace: segments end on the official lap distance.
const lapEntry = elevationProfile => ({
  composition: { tarmac: 100 },
  segments: [{ fromKm: 0, toKm: 5, type: 'tarmac' }],
  elevationProfile,
  generatedAt: '2026-09-03T00:00:00.000Z',
  stravaSegmentId: 1
})

const RAMP = [{ distanceM: 0, elevationM: 0 }, { distanceM: 5000, elevationM: 50 }]
const CLOSED = [{ distanceM: 0, elevationM: 0 }, { distanceM: 2500, elevationM: 30 }, { distanceM: 5000, elevationM: 2 }]

describe('unclosed lap profiles', () => {
  it('drops a lap profile that ends well above where it started (5k-loop)', () => {
    const { entry, profileDropped } = normalizeRouteSurfaceEntry(lapEntry(RAMP), 5, 0, 31, true)
    expect(profileDropped).toBe(true)
    expect(entry.elevationProfile).toBeUndefined()
    expect(entry.segments).toHaveLength(1)
  })

  it('keeps a lap profile that closes within noise', () => {
    const input = lapEntry(CLOSED)
    const { entry, profileDropped } = normalizeRouteSurfaceEntry(input, 5, 0, 31, true)
    expect(profileDropped).toBe(false)
    expect(entry).toBe(input)
  })

  it('leaves point-to-point routes alone - they may legitimately end elsewhere', () => {
    const input = lapEntry(RAMP)
    const { entry, profileDropped } = normalizeRouteSurfaceEntry(input, 5, 0, 31, false)
    expect(profileDropped).toBe(false)
    expect(entry).toBe(input)
  })

  it('judges a ride-covering trace by its split-off lap, not by the pen-relative raw profile', () => {
    // 2 km lead-in climbing 40 m, then a lap that closes: raw profile ends
    // 40 m above the pen, the lap-relative profile ends where it began.
    const ride = {
      composition: { tarmac: 100 },
      segments: [{ fromKm: 0, toKm: 7, type: 'tarmac' }],
      elevationProfile: [
        { distanceM: 0, elevationM: 0 },
        { distanceM: 2000, elevationM: 40 },
        { distanceM: 4500, elevationM: 70 },
        { distanceM: 7000, elevationM: 41 }
      ],
      generatedAt: '2026-09-03T00:00:00.000Z',
      stravaSegmentId: 2
    }
    const { entry, classification, profileDropped } = normalizeRouteSurfaceEntry(ride, 5, 2, 31, true)
    expect(classification).toBe('ride-split')
    expect(profileDropped).toBe(false)
    expect(entry.elevationProfile[0]).toEqual({ distanceM: 0, elevationM: 0 })
    expect(entry.leadInElevationProfile).toBeDefined()
  })
})
