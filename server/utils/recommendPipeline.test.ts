import type { H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import type { RouteWithMeta, SegmentSummary } from '../../shared/types/catalog'
import type { RecommendBaseQuery } from './apiQuerySchemas'
import { recommendRouteQuerySchema } from './apiQuerySchemas'
import type { RecommendRide, SimulateComboOptions } from './recommendPipeline'
import { runRecommendPipeline } from './recommendPipeline'
import { getRequestTiming, startRequestTiming } from './timing'
import { getRouteBySlug } from '../../shared/utils/catalog'
import { getSegmentSummary, routeWithMetaForSegment } from '../../shared/utils/routeSegments'
import { geometryForRouteLaps, geometryForSegment, geometryForWarmup, prependWarmup } from '../../shared/utils/physics'
import { sliceSurfaceSegments } from '../../shared/utils/surfaceGeometry'

/**
 * Invariants of the shared orchestration (issue #77), exercised against the
 * real catalog and the real simulator the way `scoring.test.ts` is - the two
 * endpoints differ only in the `RecommendRide` they build, so a ride assembled
 * here the way each endpoint assembles its own is the pipeline's real input.
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
const WARMUP_DISTANCE_M = 2000

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

const fakeEvent = (): H3Event => ({ path: '/api/recommend/test', context: {} } as unknown as H3Event)

/** Parsed the way a request is, so the tests read the same defaults the API applies. */
function query(params: Record<string, string> = {}): RecommendBaseQuery {
  return recommendRouteQuerySchema.parse({ weightKg: '75', heightCm: '175', powerW: '225', ...params })
}

/** Every `simulateSec` call the pipeline made, so the disclosures' call shapes can be asserted. */
type SimulateLog = Pick<SimulateComboOptions, 'powerSegmentsW' | 'powerScaleAtSpeed'>[]

/** The route endpoint's own ride, with a log of how the pipeline called it. */
function routeRide(log: SimulateLog, overrides: Partial<RecommendRide> = {}): RecommendRide {
  const ridden = overrides.route ?? route
  return {
    route: ridden,
    laps: 1,
    excludeTT: false,
    timingMeta: { route: ridden.slug },
    prepare: (simulate, rider) => {
      if (!rider) return { planGeometry: () => geometryForRouteLaps(ridden, 1) }
      const geometry = geometryForRouteLaps(ridden, 1)
      return {
        planGeometry: () => geometry,
        simulateSec: ({ frame, wheelset, powerSegmentsW, powerScaleAtSpeed }) => {
          log.push({ powerSegmentsW, powerScaleAtSpeed })
          return simulate({ rider, frame, wheelset, geometry, powerSegmentsW, powerScaleAtSpeed }).elapsedSec
        }
      }
    },
    ...overrides
  }
}

/** The segment endpoint's own ride: a warmed run minus its warm-up, so two integrations per combo. */
function segmentRide(log: SimulateLog): RecommendRide {
  const surfaceSegments = sliceSurfaceSegments(segmentRoute.surface.segments, 0, segmentRoute.distance, 'tarmac')
  return {
    route: segmentRoute,
    laps: 1,
    excludeTT: false,
    timingMeta: { segment: segmentSummary.slug, route: segmentRoute.slug },
    prepare: (simulate, rider) => {
      const geometry = geometryForSegment(segmentRoute.slug, segmentRoute.distance, segmentRoute.elevation, surfaceSegments, segmentRoute.terrain.elevationProfile)
      if (!rider) return { planGeometry: () => geometry }
      const warmedGeometry = prependWarmup(geometry, WARMUP_DISTANCE_M)
      const warmupOnlyGeometry = geometryForWarmup(WARMUP_DISTANCE_M)
      return {
        planGeometry: () => geometry,
        simulateSec: ({ frame, wheelset, powerSegmentsW, powerScaleAtSpeed }) => {
          log.push({ powerSegmentsW, powerScaleAtSpeed })
          return simulate({ rider, frame, wheelset, geometry: warmedGeometry, powerSegmentsW, powerScaleAtSpeed }).elapsedSec
            - simulate({ rider, frame, wheelset, geometry: warmupOnlyGeometry, powerScaleAtSpeed }).elapsedSec
        }
      }
    }
  }
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
    // twice (warmed, minus warm-up), which is what the log line has to report.
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

  it('lets a search reach combos the per-frame cap would have hidden', async () => {
    const capped = await runRecommendPipeline(fakeEvent(), query({ maxWheelsetsPerFrame: '1' }), routeRide([]))
    expect(new Set(capped.combos.map(combo => combo.frame.id)).size).toBe(capped.combos.length)

    const searched = await runRecommendPipeline(fakeEvent(), query({ maxWheelsetsPerFrame: '1', search: 'zipp' }), routeRide([]))
    expect(searched.combos.length).toBeGreaterThan(0)
    // The cap is skipped entirely while searching, so one frame may hold
    // several rows - the wheels it would otherwise have deleted from the page.
    expect(new Set(searched.combos.map(combo => combo.frame.id)).size).toBeLessThan(searched.combos.length)
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
})
