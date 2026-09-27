import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import type { AppliedRiderInputs, RecommendQuery, Ride, RideCourse, RiderInputs } from '#shared/utils/recommendQuery'

/**
 * Every rule the recommend request follows that doesn't need Nuxt: what the
 * query looks like, which of the rider's stored settings a given ride is
 * allowed to honour, when a cached response may answer a request, and what a
 * query change means for the list already on screen.
 *
 * Split out of `useRecommendRequest` so all of it is testable in the plain
 * node environment the rest of the suite runs in (`vitest.config.ts`) - these
 * are the rules three pages used to hand-maintain a copy of each, and the
 * ones that were only ever verified by loading the site.
 *
 * The first two - the query a Ride and a rider become, and the rider a fresh
 * visitor starts from - live in `shared/utils/recommendQuery.ts`, because the
 * markdown documents build the very same query on the server (issue #290).
 * They are re-exported here so the pages keep one import for the request.
 */
export {
  buildRecommendQuery,
  DEFAULT_RIDER_INPUTS,
  rideCategory,
  rideDraftMode,
  ridePowerW,
  riderInputsForRide,
  rideRulesForFormat
} from '#shared/utils/recommendQuery'
export type { AppliedRiderInputs, RecommendQuery, Ride, RideCourse, RiderInputs } from '#shared/utils/recommendQuery'

/**
 * The wheelsets a frame could be ridden with on this Ride, fastest first -
 * see **Wheel alternatives** in `CONTEXT.md`. `null` is the answer for a
 * Ranking that has since been replaced, which is a different answer from no
 * wheels.
 */
export type LoadWheelAlternatives = (frameId: number) => Promise<ComboScore[] | null>

/**
 * The Ranking on screen and everything it was computed from, as one object -
 * see **Applied Ranking** in `CONTEXT.md`. `useRecommendRequest` builds it
 * from the provenance of the response it accepted, and it is the whole of
 * what a ranked row or the Equipment drawer is told: a row is handed the
 * Ranking it belongs to and nothing else, and the drawer reads the one on
 * screen rather than being pushed facts by the page.
 *
 * Declared here, beside `Ride`, because the rules that read it are plain
 * functions with no Nuxt in them (`app/utils/equipmentDrawer.ts`).
 *
 * Every field is the APPLIED value, never the live control: the rider moves
 * a slider a second before the response lands, and a row that paired the new
 * lap count with the old finish time would show a speed that was never
 * computed. They move together, when a ranking is accepted.
 */
export interface AppliedRanking {
  /** The rows on screen, rank 1 first: the loaded pages in the browser, the fetched page on the server. */
  readonly combos: readonly ComboScore[]
  /** What was ranked - its course, laps, race format, power and the rules that came with them; absent when nothing was. */
  readonly ride: Ride | undefined
  /** The rider the times were computed for. */
  readonly rider: AppliedRiderInputs
  /** The filters, garage and search the pool was drawn from. */
  readonly restrictions: RiderInputs
  /** The time every gap on the page is measured against; absent when nothing ranked carries a time. */
  readonly fastestTimeSec: number | undefined
  /**
   * The serialised query these rows were fetched for, for anything that has
   * to notice when the ride being ranked changes underneath it - the drawer
   * keys its route upgrade curve on it (`upgradeCurveKey`). Only equality is
   * meaningful; nothing parses it back out.
   */
  readonly requestKey: string
  /**
   * The drill-down that ranks one frame's Wheel alternatives, so they come
   * out of the same pipeline, rider, laps, draft mode and rules as the row
   * that asked.
   *
   * It belongs to the page that produced this Ranking rather than to this
   * object: it answers under whatever that page has accepted when it is
   * called, and returns `null` once that has moved on. Which is the same
   * thing while a row holds the Ranking it is rendering, and is not once a
   * record outlives the page it was taken on - see the standing rules in
   * `equipmentDrawer.ts`.
   */
  readonly loadWheelOptions: LoadWheelAlternatives
  /**
   * The course the times were computed over, which is part of what the
   * Applied Ride is: a km/h or a "seconds off N laps of X" caption divides
   * this distance by a time from the same response. `useRecommendRequest`
   * looks it up under the Applied Ride's own identity (`ride.course`);
   * absent while that lookup has not answered for this very identity, and
   * when there is no Ride.
   */
  readonly course: RouteWithMeta | undefined
}

/** The query keys that describe the garage, and nothing else - see `recommendChangeKind`. */
const GARAGE_QUERY_KEYS: readonly (keyof RecommendQuery)[] = ['owned', 'ownedWheels']

/**
 * The recommend endpoint that ranks a course: one spelling for both kinds,
 * because two things compare against it - the request that goes out and the
 * envelope that came back (`cachedRecommendToServe`, `recommendChangeKind`) -
 * and a second spelling is how those would drift into never matching.
 */
export function recommendEndpoint(course: RideCourse): string {
  return course.kind === 'segment' ? `/api/recommend/segments/${course.slug}` : `/api/recommend/${course.slug}`
}

/**
 * The string a request is compared by. `buildRecommendQuery` fixes the key
 * order, so a query serialised on the server during prerender and the same
 * query serialised in the browser match character for character - which is
 * what lets a cached envelope be trusted (see `cachedRecommendToServe`).
 */
export function serializeRecommendQuery(query: RecommendQuery): string {
  return JSON.stringify(query)
}

/** One fetched response, with the request it was fetched for recorded alongside it. */
export interface RecommendEnvelope<T> {
  /** The endpoint the result came from - `undefined` when there was nothing to rank. */
  endpoint: string | undefined
  /** `serializeRecommendQuery` of the query it was fetched with. */
  forQuery: string
  result: T | null
}

export interface CachedRecommendLookup<E> {
  /** Nuxt's `ctx.cause` for this `getCachedData` call. */
  cause?: string
  isHydrating: boolean
  /** `nuxtApp.payload.data[key]` - what this very page was rendered with. */
  hydrationEntry: E | undefined
  /** `nuxtApp.static.data[key]` - the payload Nuxt prefetched for a client-side navigation. */
  navigationEntry: E | undefined
  endpoint: string | undefined
  serializedQuery: string
}

/**
 * Which cached envelope, if any, may answer the request about to be made.
 * This is the whole fetch-and-cache contract of the three pages, and every
 * clause of it is a bug that got out:
 *
 * - **Never for a manual refresh.** Nuxt's default answers ANY `refresh()`
 *   from the server-rendered payload while the app is still hydrating (see
 *   `getDefaultCachedData` in Nuxt's `asyncData`), and the rider's stored
 *   profile loads from localStorage inside that window - so the post-load
 *   refresh was swallowed and page one kept the default-profile times while
 *   "Show more matches" fetched with the real profile, pinning faster times
 *   to the bottom of the list (#118).
 * - **Always during hydration.** The initial load must reuse the payload the
 *   page was rendered with, or every visit spends a request re-deriving the
 *   HTML it already has.
 * - **On a client-side navigation, only when the envelope was fetched for
 *   this exact request.** These pages are prerendered with the DEFAULT rider
 *   profile and Nuxt prefetches the target page's payload into
 *   `nuxtApp.static.data` under this fetch's key. Serving that blindly froze
 *   default-profile times on every navigation from the calendar until a
 *   slider moved (#121), because nothing later corrects a stale hit: the
 *   profile was loaded into app state long before this page's setup ran, so
 *   no watcher fires. The endpoint is matched as well as the query because
 *   one key can outlive a change of course: a race page keeps its key while
 *   the selected category group moves the ranking to another route.
 */
export function cachedRecommendToServe<E extends { endpoint?: string, forQuery?: string }>(
  lookup: CachedRecommendLookup<E>
): E | undefined {
  if (lookup.cause === 'refresh:manual') return undefined
  if (lookup.isHydrating) return lookup.hydrationEntry
  const cached = lookup.navigationEntry
  if (!cached) return undefined
  return cached.endpoint === lookup.endpoint && cached.forQuery === lookup.serializedQuery ? cached : undefined
}

/** A request, as `recommendChangeKind` compares two of them. */
export interface RecommendRequest {
  endpoint: string | undefined
  query: RecommendQuery
}

/**
 * What a query change means for the results already on screen.
 *
 * - `reload` - only the garage moved. Its toggles live on the result cards
 *   themselves, so one can be fired from result 30; every expanded page is
 *   refetched and swapped in at its current length, because dropping back to
 *   nine cards would make the page abruptly shorter and leave the browser
 *   clamping the rider to the top, three pages from the bike they were
 *   looking at.
 * - `refresh` - anything else, including the endpoint. Every other control
 *   sits ABOVE the list, where the rider already is, so the list resets to
 *   page one.
 * - `none` - nothing moved. A fresh visitor's `load()` reading back the
 *   defaults it already holds must not cost a request.
 */
export function recommendChangeKind(previous: RecommendRequest, next: RecommendRequest): 'none' | 'reload' | 'refresh' {
  if (previous.endpoint !== next.endpoint) return 'refresh'
  const keys = new Set([...Object.keys(previous.query), ...Object.keys(next.query)] as (keyof RecommendQuery)[])
  let garageMoved = false
  for (const key of keys) {
    if (previous.query[key] === next.query[key]) continue
    if (!GARAGE_QUERY_KEYS.includes(key)) return 'refresh'
    garageMoved = true
  }
  return garageMoved ? 'reload' : 'none'
}
