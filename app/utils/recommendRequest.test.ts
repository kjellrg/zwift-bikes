import { describe, expect, it } from 'vitest'
import { DEFAULT_UNOWNED_LEVEL } from '../../shared/utils/classifyBikeFrame'
import { TTT_DEFAULT_RIDERS } from '../../shared/utils/physics/draft'
import { RECOMMEND_MAX_LIMIT } from '../../shared/utils/recommendLimits'
import { DEFAULT_POWER_W, DEFAULT_SPRINT_POWER_W } from '../../shared/utils/riderBounds'
import {
  buildRecommendQuery,
  rideRulesForFormat,
  cachedRecommendToServe,
  recommendChangeKind,
  rideCategory,
  riderInputsForRide,
  serializeRecommendQuery,
  type RecommendQuery,
  type RiderInputs,
  type Ride
} from './recommendRequest'

/**
 * Exactly the state a fresh visitor - and every prerender pass - holds: the
 * composable defaults of `useRiderProfile` and `usePreferences`, an empty
 * garage and an empty search box. The query built from this is the one baked
 * into the shipped HTML, so it is the one a default-profile rider must not
 * spend a request re-fetching.
 */
const DEFAULT_INPUTS: RiderInputs = {
  weightKg: 75,
  heightCm: 175,
  powerW: DEFAULT_POWER_W,
  sprintPowerW: DEFAULT_SPRINT_POWER_W,
  defaultUnownedLevel: DEFAULT_UNOWNED_LEVEL,
  draftMode: 'solo',
  tttRiders: TTT_DEFAULT_RIDERS,
  tttClimbWkg: undefined,
  verifiedOnly: true,
  myBikesOnly: false,
  bikeCategory: 'standard',
  includeHaloBikes: false,
  owned: {},
  ownedWheels: {},
  search: ''
}

const ROUTE_RIDE: Ride = { endpoint: '/api/recommend/watopia-figure-8', laps: 1 }
const SEGMENT_RIDE: Ride = { endpoint: '/api/recommend/segments/alpe-du-zwift' }

describe('buildRecommendQuery', () => {
  it('serialises the default profile and preferences to the prerendered query', () => {
    expect(buildRecommendQuery(DEFAULT_INPUTS, ROUTE_RIDE)).toEqual({
      search: undefined,
      category: 'standard',
      limit: RECOMMEND_MAX_LIMIT,
      maxWheelsetsPerFrame: 1,
      offset: 0,
      // Both always present: the endpoints' defaults differ from the client's.
      verifiedOnly: 'true',
      includeHalo: 'false',
      ownedOnly: undefined,
      owned: undefined,
      ownedWheels: undefined,
      defaultUnownedLevel: DEFAULT_UNOWNED_LEVEL,
      weightKg: 75,
      heightCm: 175,
      powerW: DEFAULT_POWER_W,
      laps: 1,
      excludeTT: undefined,
      draftMode: undefined,
      tttRiders: undefined,
      tttClimbWkg: undefined
    })
  })

  it('asks for one page of exactly what the endpoint will serve', () => {
    expect(buildRecommendQuery(DEFAULT_INPUTS, ROUTE_RIDE).limit).toBe(RECOMMEND_MAX_LIMIT)
  })

  it('omits the lap count for a segment, whose endpoint has none', () => {
    expect(buildRecommendQuery(DEFAULT_INPUTS, SEGMENT_RIDE).laps).toBeUndefined()
  })

  it('sends the garage as levels by frame id and a key list of wheels', () => {
    const query = buildRecommendQuery({ ...DEFAULT_INPUTS, owned: { 12: 3 }, ownedWheels: { zipp808: true } }, ROUTE_RIDE)
    expect(query.owned).toBe('{"12":3}')
    expect(query.ownedWheels).toBe('["zipp808"]')
  })

  describe('draft mode', () => {
    it('omits it entirely for a solo rider', () => {
      expect(buildRecommendQuery(DEFAULT_INPUTS, ROUTE_RIDE).draftMode).toBeUndefined()
    })

    it('sends the team size and climb pace for a TTT', () => {
      const query = buildRecommendQuery({ ...DEFAULT_INPUTS, draftMode: 'ttt', tttRiders: 6, tttClimbWkg: 3.4 }, ROUTE_RIDE)
      expect(query).toMatchObject({ draftMode: 'ttt', tttRiders: 6, tttClimbWkg: 3.4 })
    })

    it('sends nothing but the mode for a race - one calibrated constant, no parameters', () => {
      const query = buildRecommendQuery({ ...DEFAULT_INPUTS, draftMode: 'race', tttRiders: 6, tttClimbWkg: 3.4 }, ROUTE_RIDE)
      expect(query).toMatchObject({ draftMode: 'race', tttRiders: undefined, tttClimbWkg: undefined })
    })

    it('ranks a ride with drafting disallowed solo, whatever the stored mode', () => {
      for (const draftMode of ['ttt', 'race'] as const) {
        const query = buildRecommendQuery({ ...DEFAULT_INPUTS, draftMode }, { ...ROUTE_RIDE, draftingAllowed: false })
        expect(query).toMatchObject({ draftMode: undefined, tttRiders: undefined, tttClimbWkg: undefined })
      }
    })
  })

  describe('category', () => {
    it('omits "all" - the API spells "every category" as absent', () => {
      expect(buildRecommendQuery({ ...DEFAULT_INPUTS, bikeCategory: 'all' }, ROUTE_RIDE).category).toBeUndefined()
    })

    it('drops a TT preference on a ride that bars TT frames, and bars them server-side too', () => {
      const inputs: RiderInputs = { ...DEFAULT_INPUTS, bikeCategory: 'tt' }
      const query = buildRecommendQuery(inputs, { ...ROUTE_RIDE, ttFramesAllowed: false })
      expect(query).toMatchObject({ category: undefined, excludeTT: 'true' })
      // The rider's stored preference is untouched - it still applies to
      // every other page they open.
      expect(inputs.bikeCategory).toBe('tt')
      expect(rideCategory('tt', ROUTE_RIDE)).toBe('tt')
    })

    it('keeps a non-TT preference on a ride that bars TT frames', () => {
      expect(rideCategory('gravel', { ...ROUTE_RIDE, ttFramesAllowed: false })).toBe('gravel')
    })
  })

  describe('race format', () => {
    it('turns a format into the ride rules, and no format into no rules at all', () => {
      // The whole point of one builder: a page cannot record a format and
      // then disagree with itself about what that format allows.
      expect(rideRulesForFormat('points')).toEqual({ raceFormat: 'points', ttFramesAllowed: false, draftingAllowed: true })
      expect(rideRulesForFormat('ttt')).toEqual({ raceFormat: 'ttt', ttFramesAllowed: true, draftingAllowed: true })
      expect(rideRulesForFormat('rot')).toEqual({ raceFormat: 'rot', ttFramesAllowed: false, draftingAllowed: false })
      // Not a race: every frame is legal and the draft is the rider's own
      // business - the opposite of a race whose format is unpublished.
      expect(rideRulesForFormat(undefined)).toEqual({})
    })

    it('bars TT frames server-side for a ride told a format that outlaws them', () => {
      const barred = buildRecommendQuery(DEFAULT_INPUTS, { ...ROUTE_RIDE, ...rideRulesForFormat('scratch') })
      expect(barred.excludeTT).toBe('true')
      const allowed = buildRecommendQuery(DEFAULT_INPUTS, { ...ROUTE_RIDE, ...rideRulesForFormat('ttt') })
      expect(allowed.excludeTT).toBeUndefined()
      expect(buildRecommendQuery(DEFAULT_INPUTS, { ...ROUTE_RIDE, ...rideRulesForFormat(undefined) }).excludeTT).toBeUndefined()
    })
  })

  describe('power', () => {
    it('ranks a sprint ride at the rider\'s sprint power', () => {
      const query = buildRecommendQuery(DEFAULT_INPUTS, { ...SEGMENT_RIDE, power: 'sprint' })
      expect(query.powerW).toBe(DEFAULT_SPRINT_POWER_W)
    })

    it('ranks everything else at race power', () => {
      expect(buildRecommendQuery(DEFAULT_INPUTS, SEGMENT_RIDE).powerW).toBe(DEFAULT_POWER_W)
      expect(buildRecommendQuery(DEFAULT_INPUTS, { ...ROUTE_RIDE, power: 'race' }).powerW).toBe(DEFAULT_POWER_W)
    })
  })
})

describe('cachedRecommendToServe', () => {
  const query = buildRecommendQuery(DEFAULT_INPUTS, ROUTE_RIDE)
  const entry = { endpoint: ROUTE_RIDE.endpoint, forQuery: serializeRecommendQuery(query), result: null }
  const lookup = {
    isHydrating: false,
    hydrationEntry: { ...entry, forQuery: 'anything at all' },
    navigationEntry: entry,
    endpoint: ROUTE_RIDE.endpoint,
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
    const stored = serializeRecommendQuery(buildRecommendQuery({ ...DEFAULT_INPUTS, weightKg: 90 }, ROUTE_RIDE))
    expect(cachedRecommendToServe({ ...lookup, navigationEntry: { ...entry, forQuery: stored } })).toBeUndefined()
  })

  it('has nothing to serve when nothing was prefetched', () => {
    expect(cachedRecommendToServe({ ...lookup, navigationEntry: undefined })).toBeUndefined()
  })
})

describe('recommendChangeKind', () => {
  const endpoint = ROUTE_RIDE.endpoint
  const request = (query: RecommendQuery) => ({ endpoint, query })
  const base = buildRecommendQuery(DEFAULT_INPUTS, ROUTE_RIDE)

  it('is none when nothing moved', () => {
    expect(recommendChangeKind(request(base), request(buildRecommendQuery(DEFAULT_INPUTS, ROUTE_RIDE)))).toBe('none')
  })

  it('is a reload when only the garage moved', () => {
    const withFrames = buildRecommendQuery({ ...DEFAULT_INPUTS, owned: { 12: 3 } }, ROUTE_RIDE)
    const withWheels = buildRecommendQuery({ ...DEFAULT_INPUTS, ownedWheels: { zipp808: true } }, ROUTE_RIDE)
    expect(recommendChangeKind(request(base), request(withFrames))).toBe('reload')
    expect(recommendChangeKind(request(base), request(withWheels))).toBe('reload')
    expect(recommendChangeKind(request(withFrames), request(base))).toBe('reload')
  })

  it('is a refresh for any control above the list, the garage-only switch included', () => {
    const moved: RiderInputs[] = [
      { ...DEFAULT_INPUTS, weightKg: 90 },
      { ...DEFAULT_INPUTS, powerW: 300 },
      { ...DEFAULT_INPUTS, bikeCategory: 'all' },
      { ...DEFAULT_INPUTS, search: 'tarmac' },
      { ...DEFAULT_INPUTS, verifiedOnly: false },
      { ...DEFAULT_INPUTS, includeHaloBikes: true },
      { ...DEFAULT_INPUTS, myBikesOnly: true },
      { ...DEFAULT_INPUTS, defaultUnownedLevel: 0 },
      { ...DEFAULT_INPUTS, draftMode: 'race' }
    ]
    for (const inputs of moved) {
      expect(recommendChangeKind(request(base), request(buildRecommendQuery(inputs, ROUTE_RIDE)))).toBe('refresh')
    }
  })

  it('is a refresh when the lap count moves', () => {
    expect(recommendChangeKind(request(base), request(buildRecommendQuery(DEFAULT_INPUTS, { ...ROUTE_RIDE, laps: 3 })))).toBe('refresh')
  })

  it('is a refresh when the endpoint moves, even with an identical query', () => {
    expect(recommendChangeKind(request(base), { endpoint: '/api/recommend/tempus-fugit', query: base })).toBe('refresh')
  })

  it('is a refresh when the garage moves together with a control', () => {
    const next = buildRecommendQuery({ ...DEFAULT_INPUTS, owned: { 12: 3 }, powerW: 300 }, ROUTE_RIDE)
    expect(recommendChangeKind(request(base), request(next))).toBe('refresh')
  })
})

describe('riderInputsForRide', () => {
  const inputs: RiderInputs = { ...DEFAULT_INPUTS, weightKg: 82, heightCm: 180, powerW: 260, sprintPowerW: 900, draftMode: 'ttt', tttRiders: 6, tttClimbWkg: 3.2, bikeCategory: 'tt' }

  it('is the stored rider, made legal for an ordinary ride', () => {
    expect(riderInputsForRide(inputs, { endpoint: '/api/recommend/hilly-route', laps: 2 })).toEqual({
      weightKg: 82, heightCm: 180, powerW: 260, draftMode: 'ttt', tttRiders: 6, tttClimbWkg: 3.2, category: 'tt'
    })
  })

  it('substitutes what the ride itself dictates: sprint power, solo where drafting is off, every category where TT frames are', () => {
    expect(riderInputsForRide(inputs, { endpoint: '/api/recommend/segments/fuego-flats', power: 'sprint' }).powerW).toBe(900)
    expect(riderInputsForRide(inputs, { endpoint: '/api/recommend/hilly-route', draftingAllowed: false }).draftMode).toBe('solo')
    expect(riderInputsForRide(inputs, { endpoint: '/api/recommend/hilly-route', ttFramesAllowed: false }).category).toBe('all')
    expect(riderInputsForRide({ ...inputs, bikeCategory: 'all' }, { endpoint: '/api/recommend/hilly-route' }).category).toBe('all')
  })
})
