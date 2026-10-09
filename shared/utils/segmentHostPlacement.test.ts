import { describe, expect, it } from 'vitest'
import { routes, segments } from 'zwift-data'
import * as streams from 'zwift-data/streams'
import { placeSegmentOnTrack } from './segmentMatching'
import { placeSegmentHosts } from './segmentHostPlacement'
import { SUPPLEMENT_SEGMENT_HOSTS } from '../data/segmentHostSupplement'
import committed from '../data/segmentPlacements.generated.json'

/**
 * zwift-data placements that are not in their route track's km. Hilly Route
 * is the Hilly Loop's own Strava segment (12118362), so its route track IS
 * the segment track, 9.146 km end to end - yet zwift-data places the loop at
 * 0-9.081. Every Hilly Loop placement, in both directions, is short of the
 * segment track by the same 0.7%; the matcher's span is the track's length.
 * The Hilly Loop is a lap marker (type `segment`), never ranked or placed by
 * the generator. Listed exactly, so a change either way fails here.
 */
const ZWIFT_DATA_OFF_ITS_TRACK = [
  'hilly-loop-rev on hilly-route-rev',
  'hilly-loop-rev on hilly-route-rev-run',
  'hilly-loop on hilly-route',
  'hilly-loop on bambino-fondo'
]

describe('the track matcher, calibrated against zwift-data', () => {
  // The matcher's proof (#273): wherever zwift-data has placed a segment and
  // both tracks exist, matching the tracks lands within 50 m of zwift-data's
  // placement at both ends. zwift-data's placements are in the same frame -
  // km along the route's own recorded track.
  it('reproduces every zwift-data placement that has both tracks to within 50 m', { timeout: 30_000 }, () => {
    let checked = 0
    const misses: string[] = []
    const offTrack: string[] = []
    for (const route of routes) {
      const routeTrack = streams.routes[route.slug]
      if (!routeTrack) continue
      for (const placed of route.segmentsOnRoute ?? []) {
        const segmentTrack = streams.segments[placed.segment]
        if (!segmentTrack) continue
        checked++
        const match = placeSegmentOnTrack(routeTrack, segmentTrack)
        const hit = match.placements.some(p => Math.abs(p.fromKm - placed.from) <= 0.05 && Math.abs(p.toKm - placed.to) <= 0.05)
        if (!hit) {
          const got = match.placements.map(p => `${p.fromKm.toFixed(3)}-${p.toKm.toFixed(3)}`).join(', ') || `${match.rejection?.rule}: ${match.rejection?.detail}`
          const pair = `${placed.segment} on ${route.slug}`
          if (!ZWIFT_DATA_OFF_ITS_TRACK.includes(pair)) misses.push(`${pair}: zwift-data ${placed.from}-${placed.to}, matched ${got}`)
          else offTrack.push(pair)
        }
      }
    }
    expect(checked).toBeGreaterThan(400)
    expect(misses).toEqual([])
    expect(offTrack).toEqual(ZWIFT_DATA_OFF_ITS_TRACK)
  })
})

describe('placeSegmentHosts', () => {
  const result = placeSegmentHosts(streams)
  const placed = (route: string, segment: string) => {
    const passes = result.placements[route]?.filter(p => p.segment === segment).map(p => [p.from, p.to])
    return passes?.length ? passes : undefined
  }

  it('places zwift-data\'s own unplaced hosts, in km from the lap start', () => {
    const [kaze] = placed('kaze-kicker', 'tidepool-sprint-rev')!
    expect(kaze![0]).toBeCloseTo(1.34, 1)
    expect(kaze![1]).toBeCloseTo(1.64, 1)
    // Petit KOM ends at Petite Douleur's lap line - ZwiftInsider: "The
    // Petite KOM banner is our lap start/finish line" (13.9 km lap).
    const [petit] = placed('petite-douleur', 'petit-kom')!
    expect(petit![0]).toBeCloseTo(11.19, 1)
    expect(petit![1]).toBeCloseTo(13.86, 1)
  })
  const unplaced = (route: string, segment: string) => result.unplaced.find(u => u.route === route && u.segment === segment)

  it('reports held hosts as unplaced, with the reason they are held', () => {
    expect(unplaced('makuri-40', 'alley-sprint-rev')).toMatchObject({ reason: 'held', detail: expect.stringMatching(/Alley Sprint Strava ids are swapped/) })
    expect(unplaced('castle-to-castle', 'alley-sprint')).toMatchObject({ reason: 'held' })
    expect(unplaced('the-epiloch', 'breakaway-brae-rev')).toMatchObject({ reason: 'held', detail: expect.stringMatching(/swapped/) })
    expect(unplaced('outer-scotland', 'breakaway-brae')).toMatchObject({ reason: 'held' })
    expect(placed('the-epiloch', 'breakaway-brae-rev')).toBeUndefined()
  })

  it('takes in the supplement\'s hosts, reporting the ones with no segment track', () => {
    expect(unplaced('castle-to-castle', 'castle-park-sprint')).toMatchObject({ reason: 'no-segment-track' })
    expect(unplaced('knights-of-the-roundabout', 'pave-sprint')).toMatchObject({ reason: 'no-segment-track' })
  })

  it('never re-places a pair zwift-data has placed', () => {
    for (const route of routes) {
      for (const p of route.segmentsOnRoute ?? []) {
        expect(placed(route.slug, p.segment), `${p.segment} on ${route.slug}`).toBeUndefined()
        expect(unplaced(route.slug, p.segment), `${p.segment} on ${route.slug}`).toBeUndefined()
      }
    }
  })

  it('accounts for every sprint and climb host zwift-data has not placed: placed or reported, never both', () => {
    const rankable = new Set(segments.filter(s => s.type === 'sprint' || s.type === 'climb').map(s => s.slug))
    const hosts = [
      ...routes.flatMap(r => (r.segments ?? []).map(segment => ({ route: r.slug, segment }))),
      ...SUPPLEMENT_SEGMENT_HOSTS
    ].filter(h => rankable.has(h.segment) && !routes.find(r => r.slug === h.route)!.segmentsOnRoute?.some(p => p.segment === h.segment))
    const missing = hosts.filter(h => !placed(h.route, h.segment) === !unplaced(h.route, h.segment))
    expect(missing).toEqual([])
    expect(new Set(result.unplaced.map(u => `${u.segment} on ${u.route}`)).size).toBe(result.unplaced.length)
  })

  it('refuses a route whose placements run from the ride start rather than the lap start', () => {
    // Zwift Games 2024 Epic's zwift-data placements run past its lap, so they
    // are ride-relative; a generated, lap-relative one would mix two frames.
    expect(unplaced('zwift-games-2024-epic', 'watopia-sprint')).toMatchObject({ reason: 'ride-relative-route' })
    expect(placed('zwift-games-2024-epic', 'watopia-sprint')).toBeUndefined()
  })

  it('is what shared/data/segmentPlacements.generated.json commits - run `npm run segment-placements:compute` if not', () => {
    expect(committed).toEqual(result)
  })
})
