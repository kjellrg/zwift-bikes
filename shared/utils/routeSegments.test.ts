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

describe('measured display stats', () => {
  it('corrects titans-grove-kom-rev to the road ZwiftInsider describes', () => {
    // zwift-data publishes 61m / 6.6% for this segment; the measured profile
    // (and ZwiftInsider's segment page: 0.89km at 4.4%) say ~39m / ~4.3%.
    // The display pair must carry the measured truth.
    const summary = getAllSegmentSummaries().find(s => s.slug === 'titans-grove-kom-rev')!
    expect(summary.measuredElevationM).toBeGreaterThan(30)
    expect(summary.measuredElevationM).toBeLessThan(50)
    expect(summary.measuredAvgGradePercent).toBeGreaterThan(3.8)
    expect(summary.measuredAvgGradePercent).toBeLessThan(4.8)
  })

  it('agrees with the published scalars where they were already right', () => {
    const summary = getAllSegmentSummaries().find(s => s.slug === 'alpe-du-zwift')!
    expect(summary.measuredElevationM).toBeDefined()
    expect(Math.abs(summary.measuredElevationM! - summary.elevationM)).toBeLessThan(summary.elevationM * 0.15)
    expect(Math.abs(summary.measuredAvgGradePercent! - summary.avgGradePercent)).toBeLessThan(1.5)
  })

  it('never invents measured stats for membership segments', () => {
    for (const summary of getAllSegmentSummaries().filter(s => s.placement === 'membership')) {
      expect(summary.measuredElevationM).toBeUndefined()
      expect(summary.measuredAvgGradePercent).toBeUndefined()
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

  it('never picks a host whose slice contradicts the consensus of the other hosts', () => {
    // One known bad slice exists in the catalog (titans-grove-kom-rev on
    // tair-dringfa-fechan reads -8m where 14 other hosts agree on ~39m - a
    // placement-frame quirk on that one route), so what this locks in is the
    // invariant that actually reaches users: `pickHostRoute`'s choice must
    // always land inside the hosts' consensus, never on such an outlier.
    const routes = getRoutesWithMeta()
    const bad: string[] = []
    for (const summary of getAllSegmentSummaries()) {
      const pickedProfile = routeWithMetaForSegment(summary).terrain.elevationProfile
      if (!pickedProfile || pickedProfile.length < 2) continue
      const gains = summary.hostRoutes
        .map(h => routeWithMetaForSegmentHost(summary, routes.find(r => r.slug === h.slug)).terrain.elevationProfile)
        .filter((p): p is NonNullable<typeof p> => !!p && p.length > 1)
        .map(p => p[p.length - 1]!.elevationM)
      if (gains.length < 2) continue
      const median = gains.slice().sort((a, b) => a - b)[Math.floor(gains.length / 2)]!
      const pickedGain = pickedProfile[pickedProfile.length - 1]!.elevationM
      if (Math.abs(pickedGain - median) > Math.max(10, Math.abs(median) * 0.3)) {
        bad.push(`${summary.slug}: picked ${pickedGain.toFixed(0)}m vs median ${median.toFixed(0)}m`)
      }
    }
    expect(bad).toEqual([])
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

describe('a segment is sliced in its host\'s coordinates and delivered in its own (issue #171)', () => {
  // zwift-data's `segmentsOnRoute` placements are measured along the route's
  // real geometry, so they are in the source trace's kilometres - the last
  // placement lands on the trace's length rather than the official distance
  // on 36 of the 37 routes where the two can be told apart. The host's
  // measured arrays are rescaled onto the official distance, so a placement
  // has to be scaled the same way before it can slice them. Getting this
  // wrong reads a stretch of road offset by the whole drift: up to 8% of the
  // route, which on Valley to Mountaintop is 400 m of a 5 km course.
  const measured = getAllSegmentSummaries()
    .map(summary => ({ summary, route: routeWithMetaForSegment(summary) }))
    .filter(({ route }) => route.surface.confidence === 'measured')

  it('covers a real share of the catalog', () => {
    expect(measured.length).toBeGreaterThan(50)
  })

  it('spans each segment\'s own length exactly, leaving no unsurfaced tail', () => {
    for (const { summary, route } of measured) {
      const segments = route.surface.segments
      if (!segments?.length) continue
      expect(segments[0]!.fromKm, summary.slug).toBeCloseTo(0, 6)
      expect(segments[segments.length - 1]!.toKm, summary.slug).toBeCloseTo(summary.lengthKm, 6)
    }
  })

  it('ends each measured profile on the segment\'s own length', () => {
    for (const { summary, route } of measured) {
      const profile = route.terrain.elevationProfile
      if (!profile?.length) continue
      expect(profile[profile.length - 1]!.distanceM / 1000, summary.slug).toBeCloseTo(summary.lengthKm, 6)
    }
  })

  it('reads the summit of a summit-finish segment on the most drifting host in the catalog', () => {
    // valley-to-mountaintop's trace is 8.3% shorter than its official
    // distance, the largest disagreement anywhere. Its climb finishes at the
    // route's end, so an unscaled placement would slice a stretch ending 400 m
    // before the summit and lose the steepest part of the climb.
    const host = getRoutesWithMeta().find(route => route.slug === 'valley-to-mountaintop')!
    expect(host.surface.traceScale).toBeCloseTo(1.0909, 3)
    const climb = host.terrain.climbs.at(-1)
    expect(climb).toBeDefined()
    expect(climb!.toKm * host.surface.traceScale!).toBeCloseTo(host.distance, 1)
  })
})
