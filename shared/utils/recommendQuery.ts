import type { BikeCategory } from '../types/catalog'
import type { RaceFormat } from './events'
import { draftingAllowed, ttBikesAllowed } from './events'
import type { DraftMode } from './physics/draft'
import { TTT_DEFAULT_RIDERS } from './physics/draft'
import { RECOMMEND_MAX_LIMIT } from './recommendLimits'
import { DEFAULT_HEIGHT_CM, DEFAULT_POWER_W, DEFAULT_SPRINT_POWER_W, DEFAULT_WEIGHT_KG } from './riderBounds'
import { DEFAULT_UNOWNED_LEVEL } from './upgradeStage'

/**
 * The recommend query a Ride and a rider become, and the rider every page
 * starts from - the half of the recommend request that both sides of it
 * read (issue #290).
 *
 * The browser builds its request from this (`useRecommendRequest`, through
 * `app/utils/recommendRequest.ts`, which re-exports it), and so do the
 * markdown documents on the server (`server/utils/markdown/documents.ts`),
 * which rank the prerendered page's own Ride for `DEFAULT_RIDER_INPUTS`. One
 * builder and one set of defaults is what makes a document show the same
 * Ranking as its page, from the same cache entry - the anti-cloaking
 * contract in `docs/markdown-for-agents.md`. A copy of either on the server
 * would be a second place for the two to disagree.
 *
 * Plain values only - no Nuxt, no zod, no catalog - because it reaches a
 * client chunk (see `recommendLimits.ts` for why that matters).
 */

/**
 * Which course a Ride is on: a route or a segment, by slug. The Ride NAMES
 * its course rather than describing it (see **Ride** in `CONTEXT.md`) - the
 * geometry is looked up from this, by the page for the course it has
 * selected and by `useRecommendRequest` for the one the Applied Ranking was
 * computed over, and the endpoint that ranks it is derived from it too
 * (`recommendEndpoint` in `app/utils/recommendRequest.ts`), so no page
 * spells a URL.
 */
export interface RideCourse {
  kind: 'route' | 'segment'
  slug: string
}

/**
 * What is being ranked, plus everything the page knows about it that the
 * rider's stored profile does not. One Ride is what a page hands to
 * `useRecommendRequest` - see the term in `CONTEXT.md`.
 *
 * A Ride with nothing to rank is no Ride: a race category group racing a
 * route the catalog doesn't have hands over `undefined` instead, and then no
 * request goes out at all. Everything but `course` is optional, and absent
 * means the ordinary case: a whole route ridden with every frame legal,
 * drafting on, at race power.
 */
export interface Ride {
  course: RideCourse
  /**
   * Laps of the route. Absent for a segment, whose endpoint has no lap
   * parameter: a segment is ridden exactly once, and with no fatigue model
   * it doesn't matter which lap of a host route it falls on.
   */
  laps?: number
  /**
   * The Race format this ride is ridden under, where the page has been told
   * one: a race page from its own race, a segment page from `?rules=`. Absent
   * means the page is not riding a race at all.
   *
   * It is what the two rules below are derived from, and it exists on the
   * Ride so that a ranking can be *described* by the format it was ranked
   * under - "TT frames barred" alone does not say which rule produced it.
   * Set all three through `rideRulesForFormat`, never one at a time.
   */
  raceFormat?: RaceFormat
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

/**
 * The Ride fields a Race format fixes, as one object, so a page cannot record
 * a format and then disagree with itself about what that format allows. Both
 * pages that can be told one spread this into their Ride.
 *
 * `undefined` here means the page is not riding a race - every frame is legal
 * and the draft is the rider's own business. That is the opposite of what
 * `undefined` means to `ttBikesAllowed`, where it is a race whose format the
 * organiser hasn't published and TT frames are assumed barred; this gate is
 * the one place the two meanings are told apart.
 */
export function rideRulesForFormat(format: RaceFormat | undefined): Pick<Ride, 'raceFormat' | 'ttFramesAllowed' | 'draftingAllowed'> {
  if (!format) return {}
  return { raceFormat: format, ttFramesAllowed: ttBikesAllowed(format), draftingAllowed: draftingAllowed(format) }
}

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
export function rideCategory(stored: BikeCategory | 'all', ride: Ride | undefined): BikeCategory | undefined {
  if (stored === 'all') return undefined
  if (stored === 'tt' && ride?.ttFramesAllowed === false) return undefined
  return stored
}

/**
 * The rider's persisted draft mode, made legal for this ride - the exact
 * counterpart of `rideCategory`, and for the same reason. A ranking computed
 * at bunch speeds for a ride with no draft would be minutes fast and could
 * genuinely reorder the list, so it is forced to solo.
 */
export function rideDraftMode(stored: DraftMode, ride: Ride | undefined): DraftMode {
  return ride?.draftingAllowed === false ? 'solo' : stored
}

/**
 * The power this ride is ranked at. Sprint segments use the rider's separate
 * sprint power (see `sprintPowerW` in `useRiderProfile`): a sprint effort is
 * a different physical quantity from race-pace power, and one must never
 * stand in for the other.
 */
export function ridePowerW(inputs: Pick<RiderInputs, 'powerW' | 'sprintPowerW'>, ride: Ride | undefined): number {
  return ride?.power === 'sprint' ? inputs.sprintPowerW : inputs.powerW
}

/**
 * The rider values a ranking is computed from, once made legal for the ride
 * - see **Applied** in `CONTEXT.md`. `useRecommendRequest` captures these
 * before fetching and applies them with the ranking. Everything that explains a finish time
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

/**
 * The rider values a request for `ride` is built from - the ones that become
 * applied when its response lands. No Ride dictates nothing: the stored
 * rider, as they are.
 */
export function riderInputsForRide(inputs: RiderInputs, ride: Ride | undefined): AppliedRiderInputs {
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
export function buildRecommendQuery(inputs: RiderInputs, ride: Ride | undefined): RecommendQuery {
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
    laps: ride?.laps,
    // A LEGALITY filter, not a display trim, and `category` can't express it:
    // a points race allows road AND gravel frames, just never TT. See
    // `excludeTT` on `recommendRouteQuerySchema`.
    excludeTT: ride?.ttFramesAllowed === false ? 'true' : undefined,
    draftMode: draftMode === 'solo' ? undefined : draftMode,
    tttRiders: draftMode === 'ttt' ? inputs.tttRiders : undefined,
    tttClimbWkg: draftMode === 'ttt' ? inputs.tttClimbWkg : undefined
  }
}

/**
 * The state a fresh visitor holds - and every prerender pass, since there is
 * no localStorage at render time: the seeds of `useRiderProfile` and
 * `usePreferences`, an empty Garage and an empty search box. The composables
 * seed their state from this, and the markdown documents rank for it, so the
 * prerendered page and its markdown twin rank one rider under one set of
 * rules by construction.
 *
 * - The rider is the phantom one in `riderBounds.ts`, solo.
 * - `standard` frames only, not `all`: see `bikeCategory` in `usePreferences`.
 * - Verified equipment only, and the purchasable Halo frames left out (the
 *   endpoints' own default includes them; the pages always send the flag).
 * - Unowned frames at the site's assumed Upgrade stage.
 */
export const DEFAULT_RIDER_INPUTS: Readonly<RiderInputs> = Object.freeze({
  weightKg: DEFAULT_WEIGHT_KG,
  heightCm: DEFAULT_HEIGHT_CM,
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
  owned: Object.freeze({}),
  ownedWheels: Object.freeze({}),
  search: ''
})
