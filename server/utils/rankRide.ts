import type { H3Event } from 'h3'
import type { BikeCategory, ComboScore, RouteSummary, RouteWithMeta, SegmentSummary } from '../../shared/types/catalog'
import type { RecommendRide } from '../../shared/types/recommendRide'
import type { ClimbTrade, WheelChoice } from '../../shared/types/rideNotes'
import { toRouteSummary } from '../../shared/utils/catalog'
import type { Draft } from '../../shared/utils/physics'
import { draftOf } from '../../shared/utils/physics'
import { RouteSimulationStallError } from '../../shared/utils/physics/simulator'
import { rideForRoute, rideForSegment, WARMUP_DISTANCE_M } from '../../shared/utils/recommendRide'
import { routeWithMetaForSegment } from '../../shared/utils/routeSegments'
import type { SiteFlags } from '../../shared/utils/siteFlags'
import type { RecommendBaseQuery } from './apiQuerySchemas'
import { recommendCacheFor, recommendCacheKey } from './recommendCache'
import type { FastestOverall, RaceDisclosure, TttDisclosure } from './recommendPipeline'
import { draftNotes, runRecommendPipeline } from './recommendPipeline'
import { RECOMMEND_PAUSED_MESSAGE } from './siteFlags'
import { addTimingMeta } from './timing'

/**
 * The Ride ranking module (issue #288): the one way anything on the server
 * ranks a Ride. It takes a resolved Ride, the rider and the options a caller
 * may set, and returns one of three outcomes - the answer, a stall, or
 * paused. The recommend endpoints are its HTTP adapter; an in-process caller
 * (the MCP tools, the markdown documents) calls it directly and gets the same
 * answer, the same cache entry and the same kill switch.
 *
 * It owns three things the endpoints used to own between them:
 *
 * - **The cache.** Keyed on the normalised input (`rankingCacheInput`), not
 *   a URL, so two callers asking the same question share one entry however
 *   they spelled it; scoped by the build SHA; a stall is never stored. The
 *   storage itself is `recommendCache.ts`.
 * - **The kill switch.** `killSwitches.recommend` is checked here, before the
 *   cache is read, so no caller can skip it by not travelling over HTTP.
 * - **The response type.** `RouteRanking` and `SegmentRanking` are declared
 *   here once; the client's `RecommendResponse` is checked against them at
 *   compile time through Nitro's generated endpoint types.
 *
 * The ranking itself is `runRecommendPipeline`; the prose (`summary`/`note`)
 * that describes how the Ride was modelled is written here, per course.
 */

export type PhysicsMode = 'dynamic' | 'legacy' | 'compare'

/** A route Ride, resolved against the catalog. */
export interface RouteRide {
  kind: 'route'
  route: RouteWithMeta
  /** As asked; clamped to what the route allows (`clampLaps`). Absent means 1. */
  laps?: number
  /** The TT-frame bar a Race format fixes - a legality filter, not a display trim. */
  excludeTT?: boolean
}

/** A segment Ride, resolved against the catalog. */
export interface SegmentRide {
  kind: 'segment'
  segment: SegmentSummary
  excludeTT?: boolean
}

export type RideToRank = RouteRide | SegmentRide

/**
 * The Applied rider: all three values or no rider at all. With none, the
 * Ranking is by the 0-100 score and carries no times.
 */
export interface RankingRider {
  weightKg: number
  heightCm: number
  /** The power the Ride is ridden at - a sprint's sprint power, already substituted. */
  powerW: number
}

/** The frames and wheels a rider owns (see `CONTEXT.md`). */
export interface RankingGarage {
  /** "My garage only", with Garage fallback applied by the pipeline. */
  ownedOnly: boolean
  /** Frame id -> the Upgrade stage the rider set for it. */
  frames: Readonly<Record<string, number>>
  /** Owned wheelset keys. */
  wheels: ReadonlySet<string>
}

/** Every choice a caller may make about how the Ride is ranked. */
export interface RankingOptions {
  /** One bike category, or every category when absent. */
  category?: BikeCategory
  /** Verified (bot-tested) equipment only. */
  verifiedOnly: boolean
  /** Whether the purchasable Halo frames are shown; a hidden faster one still surfaces in `fastestOverall`. */
  includeHalo: boolean
  /** The Upgrade stage assumed for frames outside the Garage. */
  unownedUpgradeStage: number
  garage: RankingGarage
  /** A Directed search, already trimmed and lower-cased. */
  search?: string
  page: { offset: number, limit: number }
  /** How many wheelsets one frame may occupy on the page; the pipeline's default when absent. */
  maxWheelsetsPerFrame?: number
  /** Answer this frame's Wheel alternatives instead of a page of the Ranking. */
  wheelsForFrame?: number
  physics: PhysicsMode
  draft: Draft
}

/** What the pipeline ranks with, beyond the Ride itself. */
export interface RankingRequest {
  rider?: RankingRider
  options: RankingOptions
}

export interface RankRideInput<R extends RideToRank = RideToRank> extends RankingRequest {
  ride: R
  /**
   * The site flags' kill switches, as the caller's own request read them
   * (`getSiteFlags`). Required, so no caller can forget the switch.
   */
  killSwitches: SiteFlags['killSwitches']
  /**
   * The request this ranking answers, if any: its phase timings and log
   * fields, and its platform context for writing the cache off the critical
   * path. Nothing about the answer depends on it.
   */
  event?: H3Event
}

/** The physics disclosure both courses carry, before the course's own prose. */
interface RankingPhysicsBase {
  mode: PhysicsMode
  ttt?: TttDisclosure
  race?: RaceDisclosure
  rider: { weightKg: number, heightCm: number, powerW: number }
  /** One sentence for the page to lead with. */
  summary: string
  /** The full account, as the MCP tools print it. */
  note: string
}

export interface RouteRankingPhysics extends RankingPhysicsBase {
  /** Which of the three geometry sources the route's times were computed over. */
  geometry: 'measured' | 'known-climbs-compatibility' | 'aggregate-compatibility'
}

export type SegmentRankingPhysics = RankingPhysicsBase

interface RankingBase {
  /** The page, fully timed, sorted and annotated. */
  combos: ComboScore[]
  fastestOverall?: FastestOverall
  wheelChoice?: WheelChoice
  pagination: { offset: number, limit: number, returned: number, hasMore: boolean }
}

/** What `/api/recommend/:slug` answers - the Ranking of a route Ride. */
export interface RouteRanking extends RankingBase {
  route: RouteSummary
  /** Race drafting on a route with named climbs only - see `pickClimbTrade`. */
  climbTrade?: ClimbTrade
  /** Absent without a rider. */
  physics?: RouteRankingPhysics
}

/** What `/api/recommend/segments/:slug` answers - the Ranking of a segment Ride. */
export interface SegmentRanking extends RankingBase {
  segment: SegmentSummary
  physics?: SegmentRankingPhysics
}

export type RankingFor<R extends RideToRank> = R extends RouteRide ? RouteRanking : SegmentRanking

/**
 * What a stall is called wherever it is shown: the recommend endpoints' 422
 * status text, and the MCP tools' error, each followed by the simulator's own
 * account of where the rider stopped (the outcome's `message`). One wording
 * for every course, as the site has always used.
 */
export const RIDER_STALLED_MESSAGE = 'Rider cannot finish this route at this power'

/**
 * The three outcomes. `cache` says where an answer came from: `hit`/`miss`
 * against the edge cache, or `off` where there is no cache to use.
 */
export type RideRankingOutcome<T extends RouteRanking | SegmentRanking = RouteRanking | SegmentRanking>
  = | { status: 'answer', ranking: T, cache: 'hit' | 'miss' | 'off' }
    | { status: 'stall', message: string }
    | { status: 'paused', message: string }

/**
 * The rider and options a parsed recommend query asks for - how a caller
 * holding a query in the API's own terms (through `rankRideForQuery`) turns
 * one into the module's input. The query keys stay the published contract; this
 * is only their translation.
 */
export function rankingRequestFromQuery(query: RecommendBaseQuery): RankingRequest {
  const { weightKg, heightCm, powerW } = query
  return {
    rider: weightKg !== undefined && heightCm !== undefined && powerW !== undefined
      ? { weightKg, heightCm, powerW }
      : undefined,
    options: {
      category: query.category,
      verifiedOnly: query.verifiedOnly,
      includeHalo: query.includeHalo,
      unownedUpgradeStage: query.defaultUnownedLevel,
      garage: { ownedOnly: query.ownedOnly, frames: query.owned, wheels: query.ownedWheels },
      search: query.search,
      page: { offset: query.offset, limit: query.limit },
      maxWheelsetsPerFrame: query.maxWheelsetsPerFrame,
      wheelsForFrame: query.wheelsForFrame,
      physics: query.physics,
      draft: draftOf(query)
    }
  }
}

/**
 * One value in a form whose JSON is the same for every spelling of the same
 * question: object keys sorted, `undefined` fields dropped (JSON drops them
 * anyway), and a Set - whose order means nothing - as a sorted array.
 */
function canonical(value: unknown): unknown {
  if (value instanceof Set) return [...value].map(canonical).sort()
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const field = (value as Record<string, unknown>)[key]
      if (field !== undefined) out[key] = canonical(field)
    }
    return out
  }
  return value
}

/**
 * Everything the answer depends on besides the course's slug and the build,
 * as one canonical string. It is the WHOLE input the pipeline sees - the
 * Ride's laps as clamped and its TT bar, the rider, every option - which is
 * what makes it complete by construction: a new option is keyed the moment
 * it is added to `RankingOptions`, without anyone remembering to.
 */
function rankingCacheInput(ride: RecommendRide, request: RankingRequest): string {
  return JSON.stringify(canonical({ laps: ride.laps, excludeTT: ride.excludeTT, rider: request.rider, options: request.options }))
}

/** How faithfully a route's terrain is mapped, which the route's prose describes. */
function routeGeometry(route: RouteWithMeta): RouteRankingPhysics['geometry'] {
  return route.terrain.elevationProfile
    ? 'measured'
    : route.terrain.climbs.length > 0 ? 'known-climbs-compatibility' : 'aggregate-compatibility'
}

async function rankRoute(input: RankRideInput<RouteRide>, ride: RecommendRide): Promise<RouteRanking> {
  const { route } = input.ride
  const result = await runRecommendPipeline(input.event, input, ride)
  const { physics } = result
  const { tttNote, raceNote, draftSummary } = draftNotes(physics, 'the race')

  // Key order is the response's byte order - unchanged from the endpoint this
  // was lifted out of.
  return {
    route: toRouteSummary(route),
    combos: result.combos,
    fastestOverall: result.fastestOverall,
    wheelChoice: result.wheelChoice,
    climbTrade: result.climbTrade,
    physics: physics && {
      mode: physics.mode,
      ttt: physics.ttt,
      race: physics.race,
      geometry: routeGeometry(route),
      rider: physics.rider,
      summary: (route.terrain.elevationProfile
        ? 'Every time below is simulated for your weight, height and power over this route’s real, measured elevation data.'
        : route.terrain.climbs.length > 0
          ? 'Every time below is simulated for your weight, height and power, using real data for this route’s named climbs and an estimate for the rest.'
          : 'Every time below is estimated for your weight, height and power - no elevation data is mapped for this route, so its terrain is approximated.') + draftSummary,
      note: (route.terrain.elevationProfile
        ? 'Dynamic physics is active. Rider height affects aerodynamic drag; this route’s elevation profile is real, measured GPS data (not synthesized), so grade changes are modeled at their actual position along the route.'
        : route.terrain.climbs.length > 0
          ? 'Dynamic physics is active. Rider height affects aerodynamic drag; this route’s named climb(s) use real length/gradient data, with the remaining unmapped distance still synthesized from aggregate elevation.'
          : 'Dynamic physics is active. Rider height affects aerodynamic drag; route geometry is currently synthesized from aggregate distance/elevation - no named climbs are mapped for this route.') + tttNote + raceNote
    },
    pagination: result.pagination
  }
}

async function rankSegment(input: RankRideInput<SegmentRide>, ride: RecommendRide): Promise<SegmentRanking> {
  const result = await runRecommendPipeline(input.event, input, ride)
  const { physics } = result
  const { tttNote, raceNote, draftSummary } = draftNotes(physics, 'the effort')

  return {
    segment: input.ride.segment,
    combos: result.combos,
    fastestOverall: result.fastestOverall,
    wheelChoice: result.wheelChoice,
    physics: physics && {
      ...physics,
      summary: (physics.mode === 'legacy'
        ? 'Every time below is estimated for your weight, height and power at this segment’s average grade.'
        : 'Every time below is simulated for your weight, height and power, entered at racing speed rather than from a standing start.') + draftSummary,
      note: (physics.mode === 'legacy'
        ? 'Legacy finish-time model active - a constant-speed estimate at this segment’s own average grade.'
        : `Dynamic physics is active. The segment is simulated after a ${WARMUP_DISTANCE_M / 1000}km flat warmup so the timed portion starts at realistic speed, matching how a Zwift/Strava segment is actually entered (never from a standing start).`) + tttNote + raceNote
    },
    pagination: result.pagination
  }
}

/** Ranks one Ride - see the module comment. */
export async function rankRide<R extends RideToRank>(input: RankRideInput<R>): Promise<RideRankingOutcome<RankingFor<R>>> {
  if (input.killSwitches.recommend) return { status: 'paused', message: RECOMMEND_PAUSED_MESSAGE }

  const target = input.ride as RideToRank
  const ride = target.kind === 'route'
    ? rideForRoute(target.route, target.laps, target.excludeTT ?? false)
    : rideForSegment(routeWithMetaForSegment(target.segment), target.excludeTT ?? false)
  const slug = target.kind === 'route' ? target.route.slug : target.segment.slug

  const cache = recommendCacheFor(input.event)
  const key = cache && recommendCacheKey(cache.buildSha, `${target.kind}/${encodeURIComponent(slug)}`, rankingCacheInput(ride, input))
  if (cache && key) {
    const stored = await cache.read(key)
    if (stored !== undefined) {
      try {
        const ranking = JSON.parse(stored) as RankingFor<R>
        addTimingMeta(input.event, { cached: true })
        return { status: 'answer', ranking, cache: 'hit' }
      } catch {
        // A corrupt entry is a miss: computed again below, and overwritten.
      }
    }
  }

  let ranking: RouteRanking | SegmentRanking
  try {
    ranking = target.kind === 'route'
      ? await rankRoute({ ...input, ride: target }, ride)
      : await rankSegment({ ...input, ride: target }, ride)
  } catch (err) {
    // A rider who cannot hold the grade at their power makes the simulator
    // throw for that combo. It is a fact about the question (weight/power vs.
    // this course), not a fault, so it is an outcome of its own - and, being
    // returned before anything is stored, never cached.
    if (err instanceof RouteSimulationStallError) return { status: 'stall', message: err.message }
    throw err
  }

  if (cache && key) await cache.write(key, JSON.stringify(ranking))
  return { status: 'answer', ranking: ranking as RankingFor<R>, cache: cache ? 'miss' : 'off' }
}

/**
 * The course a Ride names - which route or which segment, resolved against
 * the catalog - before a query has said how it is ridden (its laps and its
 * TT bar).
 */
export type CourseToRank = Pick<RouteRide, 'kind' | 'route'> | Pick<SegmentRide, 'kind' | 'segment'>

/** The Ride a course becomes once a query has said how it is ridden. */
export type RideForCourse<C extends CourseToRank> = C extends { kind: 'route' } ? RouteRide : SegmentRide

/**
 * A parsed recommend query as a caller holds it: the shared keys, the TT bar
 * both endpoints take, and the lap count only a route's schema has.
 */
export type RecommendQueryToRank = RecommendBaseQuery & { excludeTT: boolean, laps?: number }

/**
 * Ranks a course for a query parsed with the recommend endpoints' own schema
 * - the one sequence every caller holding a query runs: the Ride that course
 * and query make (the laps and TT bar come from the query), the rider and
 * options `rankingRequestFromQuery` translates, and the caller's kill
 * switches and request. The HTTP adapter, the MCP tools and the markdown
 * documents all rank through this, each left with only its own reading of
 * the outcome.
 */
export function rankRideForQuery<C extends CourseToRank>(
  course: C,
  query: RecommendQueryToRank,
  { killSwitches, event }: Pick<RankRideInput, 'killSwitches' | 'event'>
): Promise<RideRankingOutcome<RankingFor<RideForCourse<C>>>> {
  const target = course as CourseToRank
  const ride: RideToRank = target.kind === 'route'
    ? { kind: 'route', route: target.route, laps: query.laps, excludeTT: query.excludeTT }
    : { kind: 'segment', segment: target.segment, excludeTT: query.excludeTT }
  return rankRide({ ride: ride as RideForCourse<C>, ...rankingRequestFromQuery(query), killSwitches, event })
}
