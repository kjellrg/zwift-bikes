import type { H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import type { RouteWithMeta, SegmentSummary } from '../../shared/types/catalog'
import type { RecommendBaseQuery } from './apiQuerySchemas'
import { recommendRouteQuerySchema } from './apiQuerySchemas'
import type { RecommendPipelineResult, RecommendRide, SimulateComboOptions } from './recommendPipeline'
import { runRecommendPipeline } from './recommendPipeline'
import { RECOMMEND_MAX_LIMIT, RECOMMEND_MAX_OFFSET } from '../../shared/utils/recommendLimits'
import { getRequestTiming, startRequestTiming } from './timing'
import { getFrames, getRouteBySlug } from '../../shared/utils/catalog'
import { getWheelsets } from '../../shared/utils/wheelsets'
import { getSegmentSummary, routeWithMetaForSegment } from '../../shared/utils/routeSegments'
import { rideForRoute, rideForSegment } from '../../shared/utils/recommendRide'

/**
 * Invariants of the shared orchestration (issue #77), exercised against the
 * real catalog and the real simulator the way `scoring.test.ts` is - the two
 * endpoints differ only in the `RecommendRide` they build, so the shared
 * builders supply the pipeline's real input here too.
 *
 * A short flat route and a short sprint segment keep the suite quick while
 * still running true integrations; `markPhase`/`addTimingMeta` are no-ops
 * unless a request timer was started, so a fake `{ path, context: {} }` event
 * is all either needs (same pattern as `recommendCache.test.ts`).
 */

const ROUTE_SLUG = 'tempus-fugit'
// A TTT pacing plan only has power segments where there is a long climb to
// pace differently, so the draft assertions need a route that has one.
const CLIMB_ROUTE_SLUG = 'road-to-sky'
const SEGMENT_SLUG = 'alley-sprint'

/** Fails loudly rather than through an `undefined` deep inside the pipeline if the catalog ever drops a fixture. */
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

const route = fixtureRoute(ROUTE_SLUG)
const climbRoute = fixtureRoute(CLIMB_ROUTE_SLUG)
const segmentSummary = fixtureSegment(SEGMENT_SLUG)
const segmentRoute = routeWithMetaForSegment(segmentSummary)

/**
 * The equipment the garage tests own. Read out of the real catalog rather
 * than pinned to an id and a key: what they assert is the fallback rule and
 * the compatibility rule, not which bike a rider happens to have added, and
 * the catalog drifts with every Zwift release.
 */
function fixtureEquipment() {
  // Measured, because the requests below keep the API's own `verifiedOnly`
  // default - an estimated frame or wheel would be filtered out before
  // ownership ever spoke. No off-road wheel is measured (that is what makes
  // verified+gravel the known-empty case), so only its class matters.
  const frame = getFrames().find(f => f.category === 'standard' && !f.hasFixedWheels && f.confidence === 'measured')
  const roadWheel = getWheelsets().find(w => w.crrClass === 'road' && w.confidence === 'measured')
  const offRoadWheel = getWheelsets().find(w => w.crrClass !== 'road')
  if (!frame || !roadWheel || !offRoadWheel) {
    throw new Error('the catalog no longer offers a standard frame plus a road and an off-road wheel to own')
  }
  return { frame, roadWheel, offRoadWheel }
}

const fakeEvent = (): H3Event => ({ path: '/api/recommend/test', context: {} } as unknown as H3Event)

/** Parsed the way a request is, so the tests read the same defaults the API applies. */
function query(params: Record<string, string> = {}): RecommendBaseQuery {
  return recommendRouteQuerySchema.parse({ weightKg: '75', heightCm: '175', powerW: '225', ...params })
}

/** Every `simulateSec` call the pipeline made, so the disclosures' call shapes can be asserted. */
type SimulateLog = Pick<SimulateComboOptions, 'powerSegmentsW' | 'powerScaleAtSpeed'>[]

function loggedRide(ride: RecommendRide, log: SimulateLog): RecommendRide {
  return {
    ...ride,
    prepare: (simulate, rider) => {
      const physics = ride.prepare(simulate, rider)
      const { simulateSec } = physics
      return {
        ...physics,
        simulateSec: simulateSec && ((options) => {
          log.push({ powerSegmentsW: options.powerSegmentsW, powerScaleAtSpeed: options.powerScaleAtSpeed })
          return simulateSec(options)
        })
      }
    }
  }
}

/** The route endpoint's own ride, with a log of how the pipeline called it. */
function routeRide(log: SimulateLog, overrides: Partial<RecommendRide> = {}): RecommendRide {
  return loggedRide(rideForRoute(overrides.route ?? route, overrides.laps, overrides.excludeTT), log)
}

/** The segment endpoint's own ride: warm-up then flying start, so two integrations per combo. */
function segmentRide(log: SimulateLog, excludeTT = false): RecommendRide {
  return loggedRide(rideForSegment(segmentRoute, excludeTT), log)
}

describe('runRecommendPipeline', () => {
  it('answers a route ride and a segment ride with the same shape', async () => {
    const params = { category: 'standard', includeHalo: 'false', maxWheelsetsPerFrame: '1' }
    const forRoute = await runRecommendPipeline(fakeEvent(), query(params), routeRide([]))
    const forSegment = await runRecommendPipeline(fakeEvent(), query(params), segmentRide([]))

    for (const result of [forRoute, forSegment]) {
      expect(result.combos.length).toBeGreaterThan(0)
      expect(result.pagination).toEqual({ offset: 0, limit: 9, returned: result.combos.length, hasMore: true })
      expect(result.physics).toMatchObject({ mode: 'dynamic', rider: { weightKg: 75, heightCm: 175, powerW: 225 } })
      for (const combo of result.combos) expect(combo.finishTimeSec).toBeGreaterThan(0)
    }
    expect(Object.keys(forRoute).sort()).toEqual(Object.keys(forSegment).sort())
  })

  it('counts every integration a ride runs, not every combo it times', async () => {
    const routeEvent = fakeEvent()
    startRequestTiming(routeEvent)
    const routeLog: SimulateLog = []
    await runRecommendPipeline(routeEvent, query(), routeRide(routeLog))

    const segmentEvent = fakeEvent()
    startRequestTiming(segmentEvent)
    const segmentLog: SimulateLog = []
    await runRecommendPipeline(segmentEvent, query(), segmentRide(segmentLog))

    // The route integrates once per combo it times; the segment integrates
    // twice (warm-up, then segment), which is what the log line has to report.
    expect(getRequestTiming(routeEvent)?.meta.sims).toBe(routeLog.length)
    expect(getRequestTiming(segmentEvent)?.meta.sims).toBe(segmentLog.length * 2)
    // The ride's own fields lead the log line.
    expect(Object.keys(getRequestTiming(segmentEvent)?.meta ?? {}).slice(0, 2)).toEqual(['segment', 'route'])
  })

  it('drops TT frames from the page and from fastestOverall when excludeTT is set', async () => {
    const params = { category: 'standard', includeHalo: 'false', maxWheelsetsPerFrame: '1' }
    const included = await runRecommendPipeline(fakeEvent(), query(params), routeRide([]))
    // A flat TT course: the disclosure exists precisely to admit a TT bike is quicker.
    expect(included.fastestOverall?.category).toBe('tt')

    const excluded = await runRecommendPipeline(fakeEvent(), query(params), routeRide([], { excludeTT: true }))
    expect(excluded.combos.some(combo => combo.frame.category === 'tt')).toBe(false)
    expect(excluded.fastestOverall?.category).not.toBe('tt')
  })

  // The same bar on the segment endpoint (issue #224): a scoring sprint opened
  // from a race page is ridden under that race's format, and a ranking that
  // still offered a TT frame there would be recommending a bike the rider
  // cannot start on. The ride carries the rule; the pipeline enforces it once.
  it('drops TT frames from a segment ranking too when its ride bars them', async () => {
    // No `category`, so TT frames are in the pool on their own merits - the
    // bar has to be what removes them, not a filter standing in for it.
    const params = { includeHalo: 'false', maxWheelsetsPerFrame: '1', limit: '9' }
    const included = await runRecommendPipeline(fakeEvent(), query(params), segmentRide([]))
    expect(included.combos.some(combo => combo.frame.category === 'tt')).toBe(true)

    const excluded = await runRecommendPipeline(fakeEvent(), query(params), segmentRide([], true))
    expect(excluded.combos.length).toBeGreaterThan(0)
    expect(excluded.combos.some(combo => combo.frame.category === 'tt')).toBe(false)
    expect(excluded.fastestOverall?.category).not.toBe('tt')
  })

  it('discloses the hidden fastest bike to a ranking with nothing in it, with no gap to measure', async () => {
    // Verified gravel is the known-empty case - no gravel wheel is bot-tested -
    // and it is exactly where a rider most needs to be told which filter is
    // holding the answer back (issue #221). The disclosure used to be gated on
    // the page having a rank 1, so the emptiest page never got it.
    const empty = await runRecommendPipeline(fakeEvent(), query({ category: 'gravel', includeHalo: 'false' }), routeRide([]))
    expect(empty.combos).toHaveLength(0)
    expect(empty.fastestOverall?.reason).toBe('category')
    expect(empty.fastestOverall?.frameName).toBeTruthy()
    expect(empty.fastestOverall?.finishTimeSec).toBeGreaterThan(0)
    // Nothing on the page to measure against, so the line carries no gap.
    expect(empty.fastestOverall?.deltaSec).toBeUndefined()

    // A directed search that matches nothing keeps its own message: the rider
    // asked for one bike, not for the filters to be explained.
    const searched = await runRecommendPipeline(fakeEvent(), query({ category: 'gravel', includeHalo: 'false', search: 'unobtainium' }), routeRide([]))
    expect(searched.combos).toHaveLength(0)
    expect(searched.fastestOverall).toBeUndefined()

    // A ranking that does have a rank 1 still measures the gap against it.
    const ranked = await runRecommendPipeline(fakeEvent(), query({ category: 'standard', includeHalo: 'false', maxWheelsetsPerFrame: '1' }), routeRide([]))
    expect(ranked.fastestOverall?.deltaSec).toBeGreaterThan(0)
  })

  it('lets a search reach combos the per-frame cap would have hidden', async () => {
    const capped = await runRecommendPipeline(fakeEvent(), query({ maxWheelsetsPerFrame: '1' }), routeRide([]))
    expect(new Set(capped.combos.map(combo => combo.frame.id)).size).toBe(capped.combos.length)

    const searched = await runRecommendPipeline(fakeEvent(), query({ maxWheelsetsPerFrame: '1', search: 'zipp' }), routeRide([]))
    expect(searched.combos.length).toBeGreaterThan(0)
    // The cap is skipped entirely while searching, so one frame may hold
    // several rows - the wheels it would otherwise have deleted from the page.
    expect(new Set(searched.combos.map(combo => combo.frame.id)).size).toBeLessThan(searched.combos.length)
  })

  it('lets a search reach the cosmetic re-skin the ranked pool leaves out', async () => {
    // With an empty garage the re-skin is the half of the pair that drops out
    // of a ranking (`isRedundantCosmeticVariant`, covered at the classifier),
    // so a rider who types its name is the only one who can ask for it.
    const searched = await runRecommendPipeline(fakeEvent(), query({ search: 'golden' }), routeRide([]))
    expect(searched.combos.map(combo => combo.frame.name)).toContain('Zwift Golden Concept Z1')
  })

  it('answers a drill-down with one frame, no wheel-options count, and an upgrade curve', async () => {
    const page = await runRecommendPipeline(fakeEvent(), query({ category: 'standard', includeHalo: 'false', maxWheelsetsPerFrame: '1' }), routeRide([]))
    const frame = page.combos[0]!.frame
    expect(frame.upgradeCurve).toBeDefined()

    const drillDown = await runRecommendPipeline(
      fakeEvent(),
      query({ category: 'standard', includeHalo: 'false', wheelsForFrame: String(frame.id), limit: '6' }),
      routeRide([])
    )
    expect(drillDown.combos.length).toBe(6)
    expect(drillDown.combos.every(combo => combo.frame.id === frame.id)).toBe(true)
    expect(drillDown.combos.every(combo => combo.wheelOptions === undefined)).toBe(true)
    expect(drillDown.combos[0]!.upgradeFinishTimesSec).toHaveLength(6)
    expect(drillDown.combos.slice(1).every(combo => combo.upgradeFinishTimesSec === undefined)).toBe(true)
    // A drill-down is one frame's wheels: the list's own search has nothing to say about it.
    expect(drillDown.fastestOverall).toBeUndefined()
  })

  it('never simulates without a rider profile or in legacy mode', async () => {
    const withoutProfile: SimulateLog = []
    const anonymous = await runRecommendPipeline(fakeEvent(), recommendRouteQuerySchema.parse({}), routeRide(withoutProfile))
    expect(withoutProfile).toHaveLength(0)
    expect(anonymous.physics).toBeUndefined()
    expect(anonymous.combos.every(combo => combo.finishTimeSec === undefined)).toBe(true)

    const legacy: SimulateLog = []
    const estimated = await runRecommendPipeline(fakeEvent(), query({ physics: 'legacy' }), routeRide(legacy))
    expect(legacy).toHaveLength(0)
    expect(estimated.combos.every(combo => (combo.finishTimeSec ?? 0) > 0)).toBe(true)
  })

  it('times the solo disclosures with the draft removed and nothing else changed', async () => {
    const tttLog: SimulateLog = []
    const ttt = await runRecommendPipeline(
      fakeEvent(),
      query({ draftMode: 'ttt', tttRiders: '6', tttClimbWkg: '3.5' }),
      routeRide(tttLog, { route: climbRoute })
    )
    expect(ttt.physics?.ttt?.tttSavedSec).toBeGreaterThan(0)
    // Exactly one timing loses the draft scaling: the "what would this be
    // solo?" run. It keeps the pacing plan, so nothing but the draft differs.
    const tttSolo = tttLog.filter(call => call.powerScaleAtSpeed === undefined)
    expect(tttSolo).toHaveLength(1)
    expect(tttSolo[0]!.powerSegmentsW?.length).toBeGreaterThan(0)

    const raceLog: SimulateLog = []
    const race = await runRecommendPipeline(fakeEvent(), query({ draftMode: 'race' }), routeRide(raceLog))
    expect(race.physics?.race?.raceSavedSec).toBeGreaterThan(0)
    // Race mode has no pacing plan at all, so its solo run carries neither.
    const raceSolo = raceLog.filter(call => call.powerScaleAtSpeed === undefined)
    expect(raceSolo).toHaveLength(1)
    expect(raceSolo[0]!.powerSegmentsW).toBeUndefined()
  })

  it('ranks the garage alone when it holds both frames and wheels', async () => {
    const { frame, roadWheel } = fixtureEquipment()
    const page = await runRecommendPipeline(fakeEvent(), query({
      ownedOnly: 'true',
      owned: JSON.stringify({ [frame.id]: 3 }),
      ownedWheels: JSON.stringify([roadWheel.key])
    }), routeRide([]))

    expect(page.combos.length).toBeGreaterThan(0)
    expect(page.combos.every(combo => combo.frame.id === frame.id)).toBe(true)
    expect(page.combos.every(combo => combo.wheelset?.key === roadWheel.key)).toBe(true)
  })

  it('falls back per collection when only one half of the garage is filled', async () => {
    const { frame, roadWheel } = fixtureEquipment()

    // Owned frames, no owned wheels: the rider's frames against every
    // compatible wheel, so one frame holds several rows.
    const framesOnly = await runRecommendPipeline(fakeEvent(), query({
      ownedOnly: 'true',
      owned: JSON.stringify({ [frame.id]: 3 })
    }), routeRide([]))
    expect(framesOnly.combos.every(combo => combo.frame.id === frame.id)).toBe(true)
    expect(new Set(framesOnly.combos.map(combo => combo.wheelset?.key)).size).toBeGreaterThan(1)

    // The mirror case: every frame, on the one owned wheel. A fixed-wheel
    // frame has no wheelset to match - its wheels aren't a choice the garage
    // can restrict (`rankCombos`), so it stays eligible on its own.
    const wheelsOnly = await runRecommendPipeline(fakeEvent(), query({
      ownedOnly: 'true',
      ownedWheels: JSON.stringify([roadWheel.key])
    }), routeRide([]))
    expect(new Set(wheelsOnly.combos.map(combo => combo.frame.id)).size).toBeGreaterThan(1)
    expect(wheelsOnly.combos.every(combo => combo.wheelset === undefined || combo.wheelset.key === roadWheel.key)).toBe(true)
  })

  it('ranks everything when "my garage only" is on and the garage is empty', async () => {
    const shown = (result: RecommendPipelineResult) => result.combos.map(combo => [combo.frame.name, combo.wheelset?.name])

    const emptyGarage = await runRecommendPipeline(fakeEvent(), query({ ownedOnly: 'true' }), routeRide([]))
    const unrestricted = await runRecommendPipeline(fakeEvent(), query(), routeRide([]))
    expect(shown(emptyGarage)).toEqual(shown(unrestricted))
    expect(emptyGarage.combos.length).toBeGreaterThan(0)
  })

  it('ranks a Halo bike the rider owns even while Halo bikes are hidden', async () => {
    // The three purchasable Halo bikes are heavy old frames that win nothing,
    // so no page of nine holds one: walk the whole TT ranking instead of
    // asserting a position, which is the only structural way to ask what the
    // pool contains. One wheel per frame keeps that walk to three pages.
    const espada = getFrames().find(f => f.name === 'Pinarello Espada')
    if (!espada) throw new Error('the catalog no longer has the Pinarello Espada to hide')
    const wholeRanking = async (params: Record<string, string>) => {
      const names: string[] = []
      for (let offset = 0; offset <= RECOMMEND_MAX_OFFSET; offset += RECOMMEND_MAX_LIMIT) {
        const page = await runRecommendPipeline(fakeEvent(), query({ category: 'tt', maxWheelsetsPerFrame: '1', offset: String(offset), ...params }), routeRide([]))
        names.push(...page.combos.map(combo => combo.frame.name))
        // Running out of offsets instead of pages would turn "not in the
        // ranking" into "not in the part of it we read", which passes silently.
        if (!page.pagination.hasMore) return names
      }
      throw new Error('the TT ranking no longer ends within the endpoints\' own offset bound')
    }

    expect(await wholeRanking({ includeHalo: 'true' })).toContain(espada.name)
    expect(await wholeRanking({ includeHalo: 'false' })).not.toContain(espada.name)
    // Ownership is the exception: a rider who has one in the garage is asking
    // to be ranked on the bikes they can actually select.
    expect(await wholeRanking({ includeHalo: 'false', owned: JSON.stringify({ [espada.id]: 3 }) })).toContain(espada.name)
  })

  it('leaves the page empty when the owned wheels cannot fit the owned frame', async () => {
    const { frame, offRoadWheel } = fixtureEquipment()
    // A standard frame takes road-class wheels only (`isWheelsetCompatible`),
    // so this garage is a real dead end rather than a filter to widen - the
    // page has to say so, and turning the garage restriction off is the way
    // back. `verifiedOnly=false` on purpose: no off-road wheel is measured, so
    // the default would empty the page through the verified filter instead and
    // the compatibility rule would go untested.
    const garage = { verifiedOnly: 'false', owned: JSON.stringify({ [frame.id]: 3 }), ownedWheels: JSON.stringify([offRoadWheel.key]) }
    const restricted = await runRecommendPipeline(fakeEvent(), query({ ownedOnly: 'true', ...garage }), routeRide([]))
    expect(restricted.combos).toHaveLength(0)

    const recovered = await runRecommendPipeline(fakeEvent(), query(garage), routeRide([]))
    expect(recovered.combos.length).toBeGreaterThan(0)
  })
})
