import { describe, expect, it } from 'vitest'
import {
  buildRecommendQuery,
  cachedRecommendToServe,
  DEFAULT_RIDER_INPUTS,
  recommendChangeKind,
  recommendEndpoint,
  serializeRecommendQuery,
  type RecommendQuery,
  type RiderInputs,
  type Ride
} from './recommendRequest'

/**
 * The rules in this file that still live in the app: where a Ride is ranked,
 * when a cached response may answer, and what a query change means for the
 * list on screen. The query builder they are fed from is tested beside it,
 * in `shared/utils/recommendQuery.test.ts`, which also pins the defaults.
 */

const ROUTE_RIDE: Ride = { course: { kind: 'route', slug: 'watopia-figure-8' }, laps: 1 }
const SEGMENT_RIDE: Ride = { course: { kind: 'segment', slug: 'alpe-du-zwift' } }

describe('recommendEndpoint', () => {
  it('derives where a ride is ranked from the course it names, so no page spells it', () => {
    expect(recommendEndpoint(ROUTE_RIDE.course)).toBe('/api/recommend/watopia-figure-8')
    expect(recommendEndpoint(SEGMENT_RIDE.course)).toBe('/api/recommend/segments/alpe-du-zwift')
  })
})

describe('cachedRecommendToServe', () => {
  const query = buildRecommendQuery(DEFAULT_RIDER_INPUTS, ROUTE_RIDE)
  const entry = { endpoint: recommendEndpoint(ROUTE_RIDE.course), forQuery: serializeRecommendQuery(query), result: null }
  const lookup = {
    isHydrating: false,
    hydrationEntry: { ...entry, forQuery: 'anything at all' },
    navigationEntry: entry,
    endpoint: recommendEndpoint(ROUTE_RIDE.course),
    serializedQuery: serializeRecommendQuery(query)
  }

  it('serves the page\'s own payload during hydration, whatever it was fetched for', () => {
    expect(cachedRecommendToServe({ ...lookup, isHydrating: true })).toBe(lookup.hydrationEntry)
  })

  it('never serves a manual refresh - that is what makes the post-load refetch reach the network', () => {
    expect(cachedRecommendToServe({ ...lookup, cause: 'refresh:manual' })).toBeUndefined()
    expect(cachedRecommendToServe({ ...lookup, isHydrating: true, cause: 'refresh:manual' })).toBeUndefined()
  })

  it('serves a prefetched payload fetched for this exact request', () => {
    expect(cachedRecommendToServe(lookup)).toBe(entry)
  })

  it('refuses a payload fetched from another endpoint', () => {
    expect(cachedRecommendToServe({ ...lookup, endpoint: '/api/recommend/tempus-fugit' })).toBeUndefined()
  })

  it('refuses a payload fetched for another query', () => {
    const stored = serializeRecommendQuery(buildRecommendQuery({ ...DEFAULT_RIDER_INPUTS, weightKg: 90 }, ROUTE_RIDE))
    expect(cachedRecommendToServe({ ...lookup, navigationEntry: { ...entry, forQuery: stored } })).toBeUndefined()
  })

  it('has nothing to serve when nothing was prefetched', () => {
    expect(cachedRecommendToServe({ ...lookup, navigationEntry: undefined })).toBeUndefined()
  })
})

describe('recommendChangeKind', () => {
  const endpoint = recommendEndpoint(ROUTE_RIDE.course)
  const request = (query: RecommendQuery) => ({ endpoint, query })
  const base = buildRecommendQuery(DEFAULT_RIDER_INPUTS, ROUTE_RIDE)

  it('is none when nothing moved', () => {
    expect(recommendChangeKind(request(base), request(buildRecommendQuery(DEFAULT_RIDER_INPUTS, ROUTE_RIDE)))).toBe('none')
  })

  it('is a reload when only the garage moved', () => {
    const withFrames = buildRecommendQuery({ ...DEFAULT_RIDER_INPUTS, owned: { 12: 3 } }, ROUTE_RIDE)
    const withWheels = buildRecommendQuery({ ...DEFAULT_RIDER_INPUTS, ownedWheels: { zipp808: true } }, ROUTE_RIDE)
    expect(recommendChangeKind(request(base), request(withFrames))).toBe('reload')
    expect(recommendChangeKind(request(base), request(withWheels))).toBe('reload')
    expect(recommendChangeKind(request(withFrames), request(base))).toBe('reload')
  })

  it('is a refresh for any control above the list, the garage-only switch included', () => {
    const moved: RiderInputs[] = [
      { ...DEFAULT_RIDER_INPUTS, weightKg: 90 },
      { ...DEFAULT_RIDER_INPUTS, powerW: 300 },
      { ...DEFAULT_RIDER_INPUTS, bikeCategory: 'all' },
      { ...DEFAULT_RIDER_INPUTS, search: 'tarmac' },
      { ...DEFAULT_RIDER_INPUTS, verifiedOnly: false },
      { ...DEFAULT_RIDER_INPUTS, includeHaloBikes: true },
      { ...DEFAULT_RIDER_INPUTS, myBikesOnly: true },
      { ...DEFAULT_RIDER_INPUTS, defaultUnownedLevel: 0 },
      { ...DEFAULT_RIDER_INPUTS, draftMode: 'race' }
    ]
    for (const inputs of moved) {
      expect(recommendChangeKind(request(base), request(buildRecommendQuery(inputs, ROUTE_RIDE)))).toBe('refresh')
    }
  })

  it('is a refresh when the lap count moves', () => {
    expect(recommendChangeKind(request(base), request(buildRecommendQuery(DEFAULT_RIDER_INPUTS, { ...ROUTE_RIDE, laps: 3 })))).toBe('refresh')
  })

  it('is a refresh when the endpoint moves, even with an identical query', () => {
    expect(recommendChangeKind(request(base), { endpoint: '/api/recommend/tempus-fugit', query: base })).toBe('refresh')
  })

  it('is a refresh when the garage moves together with a control', () => {
    const next = buildRecommendQuery({ ...DEFAULT_RIDER_INPUTS, owned: { 12: 3 }, powerW: 300 }, ROUTE_RIDE)
    expect(recommendChangeKind(request(base), request(next))).toBe('refresh')
  })
})
