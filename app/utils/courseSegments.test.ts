import { describe, expect, it } from 'vitest'
import type { RouteWithMeta } from '../../shared/types/catalog'
import { courseSegmentsInRideOrder } from './courseSegments'

// A hand-built route rather than one from the catalog: the Segments tab
// reads the fetched route object alone (see `routeOccurrences.ts`), so the
// test must not need zwift-data or the measured surface data either. A sprint
// sits before the lap's climb, and a hill in the lead-in before both, so
// ride order differs from "all climbs, then all sprints".
const route = {
  slug: 'fixture',
  distance: 10,
  leadInDistance: 2.5,
  terrain: {
    climbs: [
      { name: 'Lap KOM', slug: 'lap-kom', fromKm: 4, toKm: 6, lengthKm: 2, elevationM: 100, avgGradePercent: 5, climbType: '3', perLap: true },
      { name: 'Lead-in hill', slug: 'lead-in-hill', fromKm: 0.5, toKm: 1.5, lengthKm: 1, elevationM: 50, avgGradePercent: 5, perLap: false }
    ],
    sprints: [
      { name: 'Lap sprint', slug: 'lap-sprint', type: 'sprint', fromKm: 1, toKm: 1.3, lengthKm: 0.3, elevationM: 0, avgGradePercent: 0, perLap: true }
    ]
  }
} as unknown as RouteWithMeta

describe('courseSegmentsInRideOrder', () => {
  it('interleaves climbs and sprints by ride position across two laps, with the lead-in hill once', () => {
    const rows = courseSegmentsInRideOrder(route, 2)
    expect(rows.map(row => [row.kind, row.slug, row.lapNumber, row.leadIn])).toEqual([
      ['climb', 'lead-in-hill', undefined, true],
      ['sprint', 'lap-sprint', 1, false],
      ['climb', 'lap-kom', 1, false],
      ['sprint', 'lap-sprint', 2, false],
      ['climb', 'lap-kom', 2, false]
    ])
    // Positions are from the ride start: lead-in first, then each lap's offset.
    const fromKm = rows.map(row => row.rideFromKm)
    expect(fromKm[0]).toBeCloseTo(0.5, 6)
    expect(fromKm[1]).toBeCloseTo(3.5, 6)
    expect(fromKm[2]).toBeCloseTo(6.5, 6)
    expect(fromKm[3]).toBeCloseTo(13.5, 6)
    expect(fromKm[4]).toBeCloseTo(16.5, 6)
    expect(rows[4]!.rideToKm).toBeCloseTo(18.5, 6)
  })

  it('keeps each row\'s own facts: climbs carry their category and elevation, sprints carry neither', () => {
    const [hill, sprint, kom] = courseSegmentsInRideOrder(route, 1)
    expect(kom).toMatchObject({ kind: 'climb', name: 'Lap KOM', climbType: '3', lengthKm: 2, elevationM: 100, avgGradePercent: 5 })
    expect(hill).toMatchObject({ kind: 'climb', name: 'Lead-in hill', climbType: undefined, elevationM: 50 })
    expect(sprint).toMatchObject({ kind: 'sprint', name: 'Lap sprint', lengthKm: 0.3, avgGradePercent: 0 })
    expect(sprint!.elevationM).toBeUndefined()
    // One lap: nothing to label.
    expect([hill, sprint, kom].map(row => row!.lapNumber)).toEqual([undefined, undefined, undefined])
  })

  it('is empty for a route with nothing mapped', () => {
    const bare = { ...route, terrain: { climbs: [], sprints: [] } } as unknown as RouteWithMeta
    expect(courseSegmentsInRideOrder(bare, 3)).toEqual([])
  })
})
