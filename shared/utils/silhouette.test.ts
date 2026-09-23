import { describe, expect, it } from 'vitest'
import type { RouteWithMeta } from '../types/catalog'
import { routeSilhouette, silhouette, SILHOUETTE_MIN_SPAN_M, surfaceFamily } from './silhouette'

// Hand-built routes rather than catalog ones, for the same reason as
// `routeOccurrences.test.ts`: the pages draw a Silhouette from the fetched
// route object alone, so the helper must not need zwift-data or the
// measured surface table to do it.
function fixtureRoute(overrides: Partial<{ profile: { distanceM: number, elevationM: number }[], leadInDistance: number, segments: { fromKm: number, toKm: number, type: string }[] }> = {}): RouteWithMeta {
  return {
    slug: 'fixture',
    distance: 10,
    elevation: 100,
    leadInDistance: overrides.leadInDistance ?? 0,
    leadInElevation: 0,
    surface: {
      road: 80,
      gravel: 20,
      cobble: 0,
      confidence: 'measured',
      composition: { tarmac: 80, dirt: 20 },
      segments: overrides.segments ?? [
        { fromKm: 0, toKm: 4, type: 'tarmac' },
        { fromKm: 4, toKm: 6, type: 'dirt' },
        { fromKm: 6, toKm: 10, type: 'tarmac' }
      ]
    },
    terrain: {
      climbRatio: 10,
      category: 'rolling',
      weights: { aero: 0.5, climb: 0.5 },
      climbs: [
        { name: 'Lap KOM', slug: 'lap-kom', fromKm: 2, toKm: 5, lengthKm: 3, elevationM: 100, avgGradePercent: 3.3, perLap: true }
      ],
      sprints: [
        { name: 'Lap sprint', slug: 'lap-sprint', type: 'sprint', fromKm: 8, toKm: 8.5, lengthKm: 0.5, elevationM: 0, avgGradePercent: 0, perLap: true }
      ],
      elevationProfile: overrides.profile ?? [
        { distanceM: 0, elevationM: 0 },
        { distanceM: 2000, elevationM: 0 },
        { distanceM: 5000, elevationM: 100 },
        { distanceM: 10000, elevationM: 0 }
      ]
    }
  } as unknown as RouteWithMeta
}

describe('silhouette', () => {
  it('normalises every point into the unit box, lowest point at 0 and highest at 1', () => {
    const shape = silhouette({ points: [
      { distanceM: 0, elevationM: 20 },
      { distanceM: 500, elevationM: 220 },
      { distanceM: 2000, elevationM: 120 }
    ] })
    expect(shape.points.map(point => [point.x, point.y])).toEqual([[0, 0], [0.25, 1], [1, 0.5]])
    expect(shape.totalDistanceM).toBe(2000)
    expect(shape.minElevationM).toBe(20)
    expect(shape.maxElevationM).toBe(220)
  })

  it('keeps a flat profile visibly flat: under the minimum span, a bump is drawn to scale, not stretched to the top', () => {
    const shape = silhouette({ points: [
      { distanceM: 0, elevationM: 0 },
      { distanceM: 1000, elevationM: 4 },
      { distanceM: 2000, elevationM: 0 }
    ] })
    const peak = shape.points[1]!.y
    expect(peak).toBeCloseTo(4 / SILHOUETTE_MIN_SPAN_M)
    expect(peak).toBeLessThan(0.25)
    expect(Math.min(...shape.points.map(point => point.y))).toBe(0)
  })

  it('maps climb and sprint positions to fractions of the ride, clipped to it', () => {
    const shape = silhouette({
      points: [{ distanceM: 0, elevationM: 0 }, { distanceM: 10000, elevationM: 50 }],
      climbs: [{ name: 'Hill', slug: 'hill', rideFromKm: 2.5, rideToKm: 5 }, { name: 'Past the end', slug: 'past', rideFromKm: 12, rideToKm: 13 }],
      sprints: [{ name: 'Banner', slug: 'banner', rideFromKm: 9.5, rideToKm: 10.5 }]
    })
    expect(shape.climbs.map(band => [band.slug, band.from, band.to])).toEqual([['hill', 0.25, 0.5]])
    expect(shape.sprints.map(band => [band.slug, band.from, band.to])).toEqual([['banner', 0.95, 1]])
  })

  it('maps surface stretches to fractions and merges neighbours of one family', () => {
    const shape = silhouette({
      points: [{ distanceM: 0, elevationM: 0 }, { distanceM: 10000, elevationM: 0 }],
      surfaceSegments: [
        { fromM: 0, toM: 2000, surface: 'tarmac' },
        { fromM: 2000, toM: 3000, surface: 'dirt' },
        { fromM: 3000, toM: 4000, surface: 'gravel' },
        { fromM: 4000, toM: 5000, surface: 'wood' },
        { fromM: 5000, toM: 10000, surface: 'tarmac' }
      ]
    })
    expect(shape.surfaces).toEqual([
      { from: 0, to: 0.2, family: 'tarmac' },
      { from: 0.2, to: 0.4, family: 'dirt' },
      { from: 0.4, to: 0.5, family: 'rough' },
      { from: 0.5, to: 1, family: 'tarmac' }
    ])
  })

  it('resamples to an even number of points when asked, keeping both ends', () => {
    const shape = silhouette({ points: [
      { distanceM: 0, elevationM: 0 },
      { distanceM: 100, elevationM: 100 },
      { distanceM: 1000, elevationM: 0 }
    ] }, { samples: 11 })
    expect(shape.points).toHaveLength(11)
    expect(shape.points[0]!.x).toBe(0)
    expect(shape.points.at(-1)!.x).toBe(1)
    expect(shape.points[1]!.x).toBeCloseTo(0.1)
    // 100 m along is the summit; the first sample lands on it exactly.
    expect(shape.points[1]!.y).toBeCloseTo(1)
  })
})

describe('surfaceFamily', () => {
  it('sorts every surface into tarmac, the loose dirt family or the rough hard family', () => {
    expect(['dirt', 'gravel', 'grass', 'sand', 'snow'].map(surfaceFamily)).toEqual(['dirt', 'dirt', 'dirt', 'dirt', 'dirt'])
    expect(['cobbles', 'brick', 'wood'].map(surfaceFamily)).toEqual(['rough', 'rough', 'rough'])
    expect(surfaceFamily('tarmac')).toBe('tarmac')
  })
})

describe('routeSilhouette', () => {
  it('repeats the lap for a multi-lap ride and places every lap\'s climbs and surfaces', () => {
    const shape = routeSilhouette(fixtureRoute(), 2)!
    expect(shape.totalDistanceM).toBe(20000)
    // The summit at 5 km of each 10 km lap, at a quarter and three quarters of the ride.
    const summits = shape.points.filter(point => point.y === 1).map(point => point.x)
    expect(summits).toEqual([0.25, 0.75])
    expect(shape.climbs.map(band => [band.from, band.to])).toEqual([[0.1, 0.25], [0.6, 0.75]])
    expect(shape.sprints.map(band => [band.from, band.to])).toEqual([[0.4, 0.425], [0.9, 0.925]])
    expect(shape.surfaces.filter(span => span.family === 'dirt').map(span => [span.from, span.to])).toEqual([[0.2, 0.3], [0.7, 0.8]])
  })

  it('rides the lead-in once, ahead of the laps', () => {
    const shape = routeSilhouette(fixtureRoute({ leadInDistance: 2 }), 2)!
    expect(shape.totalDistanceM).toBe(22000)
    expect(shape.climbs.map(band => [band.from, band.to].map(fraction => Number(fraction.toFixed(4))))).toEqual([
      [Number((4 / 22).toFixed(4)), Number((7 / 22).toFixed(4))],
      [Number((14 / 22).toFixed(4)), Number((17 / 22).toFixed(4))]
    ])
  })

  it('has no shape for a route with no measured profile, rather than drawing the model\'s approximation', () => {
    expect(routeSilhouette(fixtureRoute({ profile: [] }), 1)).toBeUndefined()
  })

  it('draws no surface strip when the surfaces have no measured positions', () => {
    const route = fixtureRoute()
    delete (route.surface as { segments?: unknown }).segments
    expect(routeSilhouette(route, 1)!.surfaces).toEqual([])
  })
})
