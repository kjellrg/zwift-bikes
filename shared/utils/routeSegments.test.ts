import { describe, expect, it } from 'vitest'
import { getAllSegmentSummaries, routeWithMetaForSegment } from './routeSegments'
import { sliceSurfaceSegments } from './surfaceGeometry'

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
      const segmentRoute = routeWithMetaForSegment(summary!, host.slug)
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
