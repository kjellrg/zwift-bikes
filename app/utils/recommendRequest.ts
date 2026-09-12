import type { BikeCategory } from '../../shared/types/catalog'
import type { DraftMode } from '../../shared/utils/physics/draft'
import { RECOMMEND_MAX_LIMIT } from '#shared/utils/recommendLimits'

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
 */

/**
 * What is being ranked, plus everything the page knows about it that the
 * rider's stored profile does not. One Ride is what a page hands to
 * `useRecommendRequest` - see the term in `CONTEXT.md`.
 *
 * Everything but `endpoint` is optional, and absent means the ordinary case:
 * a whole route ridden with every frame legal, drafting on, at race power.
 */
export interface Ride {
  /**
   * The recommend endpoint that ranks this ride, e.g.
   * `/api/recommend/watopia-figure-8`. `undefined` when there is nothing to
   * rank - a race category group racing a route the catalog doesn't have -
   * and then no request goes out at all.
   */
  endpoint: string | undefined
  /**
   * Laps of the route. Absent for a segment, whose endpoint has no lap
   * parameter: a segment is ridden exactly once, and with no fatigue model
   * it doesn't matter which lap of a host route it falls on.
   */
  laps?: number
  /**
   * Whether TT frames may be started on. Zwift disables them for points and
   * scratch races; WTRL bans them from a Race of Truth by regulation.
   */
  ttFramesAllowed?: boolean
  /**
   * Whether the ride is drafted at all. WTRL switches drafting off entirely
   * in a Race of Truth, so it is ridden solo whatever the rider's stored
   * draft mode says.
   */
  draftingAllowed?: boolean
  /**
   * Which of the rider's two power numbers this ride is ridden at. A sprint
   * segment is a sprint effort; everything else is race pace.
   */
  power?: 'race' | 'sprint'
}

/**
 * The stored state a request is built from, as plain values: the rider's
 * profile (`useRiderProfile`), their filter preferences (`usePreferences`),
 * their garage (`useGarage`) and the debounced search box.
 */
export interface RiderInputs {
  weightKg: number
  heightCm: number
  powerW: number
  sprintPowerW: number
  defaultUnownedLevel: number
  draftMode: DraftMode
  tttRiders: number
  tttClimbWkg: number | undefined
  verifiedOnly: boolean
  myBikesOnly: boolean
  bikeCategory: BikeCategory | 'all'
  includeHaloBikes: boolean
  owned: Record<number, number>
  ownedWheels: Record<string, true>
  /** The bike search box, already debounced. */
  search: string
}

/** The query both recommend endpoints are called with, as `$fetch` takes it. */
export interface RecommendQuery {
  search?: string
  category?: BikeCategory
  limit: number
  maxWheelsetsPerFrame: number
  offset: number
  verifiedOnly: 'true' | 'false'
  includeHalo: 'true' | 'false'
  ownedOnly?: 'true'
  owned?: string
  ownedWheels?: string
  defaultUnownedLevel: number
  weightKg: number
  heightCm: number
  powerW: number
  laps?: number
  excludeTT?: 'true'
  draftMode?: Exclude<DraftMode, 'solo'>
  tttRiders?: number
  tttClimbWkg?: number
}

/** The query keys that describe the garage, and nothing else - see `recommendChangeKind`. */
const GARAGE_QUERY_KEYS: readonly (keyof RecommendQuery)[] = ['owned', 'ownedWheels']

/**
 * The rider's persisted bike category, made legal for this ride: a rider
 * whose stored category is `tt` opening a race where TT frames are outlawed
 * is ranked across all legal categories instead (matching the "All
 * categories" the hidden-TT select shows them), WITHOUT their stored
 * preference being touched - it still applies to every other page they open.
 *
 * `undefined` is the API's own spelling of "every category": the endpoint
 * reads any non-empty `category` as a value to match against, so sending
 * `all` would match no frame at all.
 */
export function rideCategory(stored: BikeCategory | 'all', ride: Ride): BikeCategory | undefined {
  if (stored === 'all') return undefined
  if (stored === 'tt' && ride.ttFramesAllowed === false) return undefined
  return stored
}

/**
 * The rider's persisted draft mode, made legal for this ride - the exact
 * counterpart of `rideCategory`, and for the same reason. A ranking computed
 * at bunch speeds for a ride with no draft would be minutes fast and could
 * genuinely reorder the list, so it is forced to solo.
 */
export function rideDraftMode(stored: DraftMode, ride: Ride): DraftMode {
  return ride.draftingAllowed === false ? 'solo' : stored
}

/**
 * The power this ride is ranked at. Sprint segments use the rider's separate
 * sprint power (see `sprintPowerW` in `useRiderProfile`): a sprint effort is
 * a different physical quantity from race-pace power, and one must never
 * stand in for the other.
 */
export function ridePowerW(inputs: Pick<RiderInputs, 'powerW' | 'sprintPowerW'>, ride: Ride): number {
  return ride.power === 'sprint' ? inputs.sprintPowerW : inputs.powerW
}

/**
 * The rider values a ranking is computed from, once made legal for the ride
 * - see **Applied** in `CONTEXT.md`. `useRecommendRequest` snapshots one of
 * these when a response lands, and everything that explains a finish time
 * (the rider strip, the answer, the equipment-dependent analysis) reads that
 * snapshot rather than the stored profile, so a time is never explained by
 * inputs it was not computed from.
 */
export interface AppliedRiderInputs {
  weightKg: number
  heightCm: number
  /** The power the ride was ridden at - sprint power on a sprint segment. */
  powerW: number
  draftMode: DraftMode
  tttRiders: number
  tttClimbWkg: number | undefined
  /** `all` where the query would omit the key - the display spelling of every category. */
  category: BikeCategory | 'all'
}

/** The rider values a request for `ride` is built from - the ones that become applied when its response lands. */
export function riderInputsForRide(inputs: RiderInputs, ride: Ride): AppliedRiderInputs {
  return {
    weightKg: inputs.weightKg,
    heightCm: inputs.heightCm,
    powerW: ridePowerW(inputs, ride),
    draftMode: rideDraftMode(inputs.draftMode, ride),
    tttRiders: inputs.tttRiders,
    tttClimbWkg: inputs.tttClimbWkg,
    category: rideCategory(inputs.bikeCategory, ride) ?? 'all'
  }
}

/**
 * The recommend query for a ride and a rider.
 *
 * Two encodings are load-bearing and easy to get wrong, which is why this is
 * one function rather than three page-local copies:
 *
 * - `verifiedOnly` and `includeHalo` are ALWAYS sent, never omitted, because
 *   the endpoints' defaults deliberately differ from the client's (the
 *   endpoint defaults to verified-on and halo-included; the preferences
 *   default to verified-on and halo-excluded). Leaving either out would
 *   silently rank a different pool than the switches claim.
 * - `category` and `draftMode` are omitted for their "everything"/"nothing"
 *   values rather than sent - see `rideCategory` for `all`, and note that
 *   solo is also the default every page is prerendered with, so the default
 *   query stays the short one crawlers see.
 *
 * `race` draft mode sends nothing but the mode itself - one field-calibrated
 * constant, no parameters - so its cache key stays as clean as solo's.
 */
export function buildRecommendQuery(inputs: RiderInputs, ride: Ride): RecommendQuery {
  const draftMode = rideDraftMode(inputs.draftMode, ride)
  return {
    search: inputs.search || undefined,
    category: rideCategory(inputs.bikeCategory, ride),
    // One page, exactly as deep as the endpoint will serve - see `RECOMMEND_MAX_LIMIT`.
    limit: RECOMMEND_MAX_LIMIT,
    // One row per bike: a frame's other wheels live behind the result row's
    // own disclosure (`ComboWheelAlternatives` in `RideAlternativeRow`), not as repeat rows that spend
    // the page's nine slots - and the simulated-ordering window with them -
    // on the same bike two or three times.
    maxWheelsetsPerFrame: 1,
    offset: 0,
    verifiedOnly: inputs.verifiedOnly ? 'true' : 'false',
    includeHalo: inputs.includeHaloBikes ? 'true' : 'false',
    ownedOnly: inputs.myBikesOnly ? 'true' : undefined,
    owned: Object.keys(inputs.owned).length ? JSON.stringify(inputs.owned) : undefined,
    ownedWheels: Object.keys(inputs.ownedWheels).length ? JSON.stringify(Object.keys(inputs.ownedWheels)) : undefined,
    defaultUnownedLevel: inputs.defaultUnownedLevel,
    weightKg: inputs.weightKg,
    heightCm: inputs.heightCm,
    powerW: ridePowerW(inputs, ride),
    laps: ride.laps,
    // A LEGALITY filter, not a display trim, and `category` can't express it:
    // a points race allows road AND gravel frames, just never TT. See
    // `excludeTT` on `recommendRouteQuerySchema`.
    excludeTT: ride.ttFramesAllowed === false ? 'true' : undefined,
    draftMode: draftMode === 'solo' ? undefined : draftMode,
    tttRiders: draftMode === 'ttt' ? inputs.tttRiders : undefined,
    tttClimbWkg: draftMode === 'ttt' ? inputs.tttClimbWkg : undefined
  }
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
