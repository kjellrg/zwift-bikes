import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteWithMeta, SegmentSummary } from '../../shared/types/catalog'
import { getRouteBySlug } from '../../shared/utils/catalog'
import { getSegmentSummary } from '../../shared/utils/routeSegments'
import { DEFAULT_SITE_FLAGS } from '../../shared/utils/siteFlags'
import { recommendRouteQuerySchema, recommendSegmentQuerySchema } from './apiQuerySchemas'
import type { RankingOptions, RankRideInput, RouteRide } from './rankRide'
import { rankingRequestFromQuery, rankRide } from './rankRide'
import { RECOMMEND_PAUSED_MESSAGE } from './siteFlags'

/**
 * The Ride ranking module, called the way every in-process caller calls it:
 * a resolved Ride, the rider and the options, with no request and no
 * `$fetch`. The ranking itself runs for real against the catalog and the
 * simulator (a short flat route and a short sprint keep it quick); only the
 * platform around it - the Workers Cache API and the runtime config's build
 * SHA - is stood in for, as `recommendCache.test.ts` does.
 */

function fixtureRoute(slug: string): RouteWithMeta {
  const found = getRouteBySlug(slug)
  if (!found) throw new Error(`test fixture route "${slug}" is missing from the catalog`)
  return found
}

function fixtureSegment(slug: string): SegmentSummary {
  const found = getSegmentSummary(slug)
  if (!found) throw new Error(`test fixture segment "${slug}" is missing from the catalog`)
  return found
}

const flatRoute = fixtureRoute('tempus-fugit')
const climbRoute = fixtureRoute('road-to-sky')
const sprint = fixtureSegment('alley-sprint')

const RIDER = { weightKg: 75, heightCm: 175, powerW: 225 }
/** Cannot hold Road to Sky's grade: the simulator stops them dead. */
const STALLING_RIDER = { weightKg: 200, heightCm: 220, powerW: 9 }

/** What the site's ranking pages ask for by default, written out rather than derived. */
function siteOptions(overrides: Partial<RankingOptions> = {}): RankingOptions {
  return {
    category: 'standard',
    verifiedOnly: true,
    includeHalo: false,
    unownedUpgradeStage: 5,
    garage: { ownedOnly: false, frames: {}, wheels: new Set() },
    search: undefined,
    page: { offset: 0, limit: 3 },
    maxWheelsetsPerFrame: 1,
    wheelsForFrame: undefined,
    physics: 'dynamic',
    draft: { mode: 'solo' },
    ...overrides
  }
}

const KILL_SWITCHES_OFF = DEFAULT_SITE_FLAGS.killSwitches
const RECOMMEND_KILLED = { ...DEFAULT_SITE_FLAGS.killSwitches, recommend: true }

function routeInput(overrides: Partial<RankRideInput<RouteRide>> = {}): RankRideInput<RouteRide> {
  return {
    ride: { kind: 'route', route: flatRoute, laps: 1, excludeTT: false },
    rider: RIDER,
    options: siteOptions(),
    killSwitches: KILL_SWITCHES_OFF,
    ...overrides
  }
}

/**
 * In-memory stand-in for `caches.default`, faithful to what the module
 * depends on: `put` consumes a `Response` body, `match` hands it back via
 * `text()`, both keyed by exact URL string.
 */
function fakeCaches() {
  const store = new Map<string, string>()
  const match = vi.fn(async (key: string) => {
    const body = store.get(key)
    return body === undefined ? undefined : { text: async () => body }
  })
  return {
    store,
    match,
    caches: {
      default: {
        match,
        async put(key: string, response: Response) {
          store.set(key, await response.text())
        }
      }
    }
  }
}

describe('rankRide without a cache', () => {
  it('answers a route with its Ranking, the physics and the prose', async () => {
    const outcome = await rankRide(routeInput())
    expect(outcome.status).toBe('answer')
    if (outcome.status !== 'answer') return
    const { ranking } = outcome
    expect(ranking.route.slug).toBe('tempus-fugit')
    expect(ranking.combos).toHaveLength(3)
    const times = ranking.combos.map(combo => combo.finishTimeSec!)
    expect(times.every(seconds => seconds > 0)).toBe(true)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(ranking.physics?.mode).toBe('dynamic')
    expect(ranking.physics?.geometry).toBe('measured')
    expect(ranking.physics?.rider).toEqual({ weightKg: 75, heightCm: 175, powerW: 225 })
    expect(ranking.physics?.summary).toMatch(/^Every time below is simulated/)
    expect(ranking.physics?.note).toMatch(/^Dynamic physics is active/)
    expect(ranking.pagination).toEqual({ offset: 0, limit: 3, returned: 3, hasMore: true })
    expect(outcome.cache).toBe('off')
  })

  it('answers a segment, with the draft note for the effort', async () => {
    const outcome = await rankRide({
      ride: { kind: 'segment', segment: sprint, excludeTT: false },
      rider: { ...RIDER, powerW: 600 },
      options: siteOptions({ draft: { mode: 'race' } }),
      killSwitches: KILL_SWITCHES_OFF
    })
    expect(outcome.status).toBe('answer')
    if (outcome.status !== 'answer') return
    expect(outcome.ranking.segment.slug).toBe('alley-sprint')
    expect(outcome.ranking.combos.length).toBeGreaterThan(0)
    expect(outcome.ranking.physics?.race?.savingPct).toBeGreaterThan(0)
    expect(outcome.ranking.physics?.note).toContain('your OWN average for the effort')
    expect(outcome.ranking.physics?.summary).toMatch(/Ridden in a typical mass-start bunch/)
  })

  it('ranks by score, with no physics, when there is no rider', async () => {
    const outcome = await rankRide(routeInput({ rider: undefined }))
    expect(outcome.status).toBe('answer')
    if (outcome.status !== 'answer') return
    expect(outcome.ranking.physics).toBeUndefined()
    expect(outcome.ranking.combos[0]?.finishTimeSec).toBeUndefined()
  })

  it('says a rider who cannot hold the grade stalls, in the simulator\'s words', async () => {
    const outcome = await rankRide(routeInput({ ride: { kind: 'route', route: climbRoute, laps: 1, excludeTT: false }, rider: STALLING_RIDER }))
    expect(outcome).toEqual({ status: 'stall', message: expect.stringMatching(/^Rider \(200 kg, 9 W\) stalled on a/) })
  })

  it('refuses while the recommend kill switch is on, before any ranking work', async () => {
    // A stalling rider would take the pipeline to the simulator; paused must win before that.
    const outcome = await rankRide(routeInput({ ride: { kind: 'route', route: climbRoute, laps: 1, excludeTT: false }, rider: STALLING_RIDER, killSwitches: RECOMMEND_KILLED }))
    expect(outcome).toEqual({ status: 'paused', message: RECOMMEND_PAUSED_MESSAGE })
  })
})

describe('rankRide with the edge cache', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { buildSha: 'abc1234' } }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('computes on a miss, stores the JSON, and serves the same ranking on a hit', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)

    const miss = await rankRide(routeInput())
    expect(miss.status).toBe('answer')
    if (miss.status !== 'answer') return
    expect(miss.cache).toBe('miss')
    expect(store.size).toBe(1)
    expect([...store.values()][0]).toBe(JSON.stringify(miss.ranking))

    const hit = await rankRide(routeInput())
    expect(hit.status).toBe('answer')
    if (hit.status !== 'answer') return
    expect(hit.cache).toBe('hit')
    expect(hit.ranking).toEqual(miss.ranking)
    expect(store.size).toBe(1)
  })

  it('keys a different question, and a different build, apart', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)

    await rankRide(routeInput({ rider: undefined }))
    const otherPage = await rankRide(routeInput({ rider: undefined, options: siteOptions({ page: { offset: 3, limit: 3 } }) }))
    expect(otherPage.status === 'answer' && otherPage.cache).toBe('miss')
    const otherRide = await rankRide(routeInput({ rider: undefined, ride: { kind: 'route', route: flatRoute, laps: 2, excludeTT: false } }))
    expect(otherRide.status === 'answer' && otherRide.cache).toBe('miss')

    vi.stubGlobal('useRuntimeConfig', () => ({ public: { buildSha: 'def5678' } }))
    const nextBuild = await rankRide(routeInput({ rider: undefined }))
    expect(nextBuild.status === 'answer' && nextBuild.cache).toBe('miss')
    expect(store.size).toBe(4)
  })

  it('never caches a stall', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)
    const stalling = routeInput({ ride: { kind: 'route', route: climbRoute, laps: 1, excludeTT: false }, rider: STALLING_RIDER })

    expect((await rankRide(stalling)).status).toBe('stall')
    expect(store.size).toBe(0)
    expect((await rankRide(stalling)).status).toBe('stall')
    expect(store.size).toBe(0)
  })

  it('checks the kill switch before the cache, so a stored ranking cannot slip out while paused', async () => {
    const { caches, match } = fakeCaches()
    vi.stubGlobal('caches', caches)
    await rankRide(routeInput({ rider: undefined }))
    match.mockClear()

    const paused = await rankRide(routeInput({ rider: undefined, killSwitches: RECOMMEND_KILLED }))
    expect(paused.status).toBe('paused')
    expect(match).not.toHaveBeenCalled()
  })

  it('shares one entry between two callers that spell the same question differently', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)
    // Every field in a different order, and the same Garage listed in a different order.
    const first = await rankRide(routeInput({
      rider: undefined,
      options: siteOptions({ garage: { ownedOnly: false, frames: { 6: 3, 12: 5 }, wheels: new Set(['zipp-808', 'dt-swiss-arc-1100']) } })
    }))
    const reordered = await rankRide({
      killSwitches: KILL_SWITCHES_OFF,
      options: {
        draft: { mode: 'solo' },
        physics: 'dynamic',
        maxWheelsetsPerFrame: 1,
        page: { limit: 3, offset: 0 },
        garage: { wheels: new Set(['dt-swiss-arc-1100', 'zipp-808']), frames: { 12: 5, 6: 3 }, ownedOnly: false },
        unownedUpgradeStage: 5,
        includeHalo: false,
        verifiedOnly: true,
        category: 'standard'
      },
      rider: undefined,
      ride: { excludeTT: false, laps: 1, route: flatRoute, kind: 'route' }
    })
    expect(first.status === 'answer' && first.cache).toBe('miss')
    expect(reordered.status === 'answer' && reordered.cache).toBe('hit')
    expect(store.size).toBe(1)
  })

  it('shares one entry between two query strings with their parameters in a different order', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)
    const fromQuery = (raw: string) => {
      const query = recommendRouteQuerySchema.parse(Object.fromEntries(new URLSearchParams(raw)))
      return rankRide({
        ride: { kind: 'route', route: flatRoute, laps: query.laps, excludeTT: query.excludeTT },
        ...rankingRequestFromQuery(query),
        killSwitches: KILL_SWITCHES_OFF
      })
    }

    const first = await fromQuery('category=standard&limit=3&verifiedOnly=true&includeHalo=false&maxWheelsetsPerFrame=1')
    // Reordered, and spelling out two values the schema would default to anyway.
    const second = await fromQuery('maxWheelsetsPerFrame=1&includeHalo=false&physics=dynamic&verifiedOnly=true&limit=3&category=standard&draftMode=solo')
    expect(first.status === 'answer' && first.cache).toBe('miss')
    expect(second.status === 'answer' && second.cache).toBe('hit')
    expect(store.size).toBe(1)
  })

  it('keys a segment apart from a route', async () => {
    const { caches, store } = fakeCaches()
    vi.stubGlobal('caches', caches)
    const query = recommendSegmentQuerySchema.parse({ limit: '3' })
    await rankRide({ ride: { kind: 'segment', segment: sprint, excludeTT: false }, ...rankingRequestFromQuery(query), killSwitches: KILL_SWITCHES_OFF })
    await rankRide(routeInput({ rider: undefined }))
    expect(store.size).toBe(2)
  })
})
