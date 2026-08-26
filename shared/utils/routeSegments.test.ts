import { describe, expect, it } from 'vitest'
import { getAllSegmentSummaries, routeWithMetaForSegment, routeWithMetaForSegmentHost } from './routeSegments'
import { getRoutesWithMeta } from './catalog'
import { sliceSurfaceSegments } from './surfaceGeometry'

function hostRouteBySlug(slug: string) {
  return getRoutesWithMeta().find(r => r.slug === slug)
}

describe('segment surface slices are host-independent', () => {
  // The acceptance check from issue #126: the Alpe du Zwift is the same
  // physical (all-tarmac) road on every route that hosts it, so every host
  // must slice the same surface mix for the segment. Before the placement
  // frame fix, high-lead-in hosts sliced up to 2.4km of the jungle's dirt
  // into the Alpe's span - which is why /segments/alpe-du-zwift gave
  // different times depending on which route it was reached from.
  it('every host of alpe-du-zwift slices an all-tarmac segment', () => {
    const summary = getAllSegmentSummaries().find(s => s.slug === 'alpe-du-zwift')
    expect(summary).toBeDefined()
    expect(summary!.hostRoutes.length).toBeGreaterThan(1)
    const bad: string[] = []
    for (const host of summary!.hostRoutes) {
      const segmentRoute = routeWithMetaForSegmentHost(summary!, hostRouteBySlug(host.slug))
      if (!segmentRoute.surface.segments) continue
      const sliced = sliceSurfaceSegments(segmentRoute.surface.segments, 0, segmentRoute.distance, 'tarmac')
      const offRoadM = sliced.filter(s => s.surface !== 'tarmac').reduce((sum, s) => sum + (s.toM - s.fromM), 0)
      const totalM = segmentRoute.distance * 1000
      // Allow GPS-noise slivers at the boundaries, never a real stretch.
      if (offRoadM > totalM * 0.01) bad.push(`${host.slug}: ${offRoadM.toFixed(0)}m off-tarmac`)
    }
    expect(bad).toEqual([])
  })
})

describe('routeWithMetaForSegment host selection', () => {
  it('is deterministic and picks a measured host for alpe-du-zwift', () => {
    const summary = getAllSegmentSummaries().find(s => s.slug === 'alpe-du-zwift')!
    const first = routeWithMetaForSegment(summary)
    const second = routeWithMetaForSegment(summary)
    expect(second).toEqual(first)
    // The pick must land on a host with measured positional surface data -
    // that's the whole point of picking instead of blindly taking hostRoutes[0].
    expect(first.surface.confidence).toBe('measured')
    expect(first.surface.segments).toBeDefined()
  })

  it('keeps membership segments honest: unverified surface, no positional segments, no profile', () => {
    const membership = getAllSegmentSummaries().filter(s => s.placement === 'membership')
    expect(membership.length).toBeGreaterThan(0)
    for (const summary of membership) {
      const segmentRoute = routeWithMetaForSegment(summary)
      expect(segmentRoute.surface.confidence).not.toBe('measured')
      expect(segmentRoute.surface.confidence).not.toBe('curated')
      expect(segmentRoute.surface.segments).toBeUndefined()
      // No placement on any host means no stretch of any measured profile can
      // honestly be attributed to this segment.
      expect(segmentRoute.terrain.elevationProfile).toBeUndefined()
    }
  })
})

describe('segment elevation profiles', () => {
  it('slices a full-length, full-gain profile for alpe-du-zwift', () => {
    const summary = getAllSegmentSummaries().find(s => s.slug === 'alpe-du-zwift')!
    const segmentRoute = routeWithMetaForSegment(summary)
    const profile = segmentRoute.terrain.elevationProfile
    expect(profile).toBeDefined()
    expect(profile!.length).toBeGreaterThan(2)
    expect(profile![0]).toEqual({ distanceM: 0, elevationM: 0 })
    const last = profile![profile!.length - 1]!
    // The slice covers the segment's own span: Strava-measured distance may
    // disagree with the official length by a few percent, never more.
    expect(last.distanceM).toBeGreaterThan(summary.lengthKm * 1000 * 0.9)
    expect(last.distanceM).toBeLessThan(summary.lengthKm * 1000 * 1.1)
    // A pure climb's net gain over the slice must land near the segment's
    // own published elevation.
    expect(Math.abs(last.elevationM - summary.elevationM)).toBeLessThan(summary.elevationM * 0.15)
  })

  it('slices the same climb out of every host that measured it', () => {
    const summary = getAllSegmentSummaries().find(s => s.slug === 'alpe-du-zwift')!
    const gains: number[] = []
    for (const host of summary.hostRoutes) {
      const segmentRoute = routeWithMetaForSegmentHost(summary, hostRouteBySlug(host.slug))
      const profile = segmentRoute.terrain.elevationProfile
      if (!profile) continue
      gains.push(profile[profile.length - 1]!.elevationM)
    }
    expect(gains.length).toBeGreaterThan(1)
    const spread = Math.max(...gains) - Math.min(...gains)
    // Same physical road on every host - the measured gains may differ by GPS
    // noise, never by a real stretch of climbing.
    expect(spread).toBeLessThan(summary.elevationM * 0.05)
  })
})
