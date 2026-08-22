import type { H3Event } from 'h3'
import { createError, getQuery } from 'h3'
import { z } from 'zod'
import type { Sport, WorldSlug } from 'zwift-data'
import type { BikeCategory, RouteFilters } from '../../shared/types/catalog'
import { getWorlds } from '../../shared/utils/catalog'
import { DEFAULT_UNOWNED_LEVEL } from '../../shared/utils/classifyBikeFrame'
import { clampTttClimbWkg, clampTttRiders, TTT_MAX_CLIMB_WKG, TTT_MAX_RIDERS, TTT_MIN_CLIMB_WKG, TTT_MIN_RIDERS } from '../../shared/utils/physics'
import { RIDER_BOUNDS } from '../../shared/utils/riderBounds'
import { MAX_LAPS } from '../../shared/utils/routeLaps'

/**
 * Zod schemas for every query parameter the API accepts (issue #45).
 *
 * The contract is strict: a value that is outright wrong - an unknown enum
 * member, a non-numeric number, JSON that doesn't parse - AND a value outside
 * its documented range (`laps=999`, `limit=50`) both get a 400 with a message
 * naming the parameter and what it accepts. A silent clamp is
 * indistinguishable from a bypassed limit to the caller, so out-of-range
 * values reject rather than degrade. The exceptions are deliberate and
 * documented on their fields: semantic normalization stays (laps forced to 1
 * on a point-to-point route, TTT values snapped to their control's step), and
 * garage upgrade levels clamp because they come from users' persisted
 * localStorage, where a stale value must not permanently break a page.
 *
 * Deliberately `z.object`, never `z.strictObject`: query strings legitimately
 * carry junk parameters (`utm_*`, `fbclid`) on shared links, so unknown keys
 * are ignored - only wrong values of known keys reject. (`strictObject`
 * remains right for `shared/utils/events.ts`, which validates curated files.)
 */

/**
 * The runtime source for each catalog enum, alongside the hand-written union
 * types in `shared/types/catalog.ts` (which mirror TS-only types from
 * `zwift-data`, so they can't be derived at runtime). `satisfies` rejects a
 * misspelled entry here; the exported `ExpectNever` guards below reject a
 * union member missing from the list - drift fails typecheck both ways.
 */
export const BIKE_CATEGORIES = ['standard', 'tt', 'gravel', 'handbike', 'funbike'] as const satisfies readonly BikeCategory[]
export const SPORTS = ['cycling', 'running'] as const satisfies readonly Sport[]
export const ROUTE_SURFACE_FILTERS = ['gravel', 'cobble'] as const satisfies readonly NonNullable<RouteFilters['surface']>[]

type ExpectNever<T extends never> = T
export type _BikeCategoryDriftGuard = ExpectNever<Exclude<BikeCategory, (typeof BIKE_CATEGORIES)[number]>>
export type _SportDriftGuard = ExpectNever<Exclude<Sport, (typeof SPORTS)[number]>>

// Rider profile bounds live in `shared/utils/riderBounds.ts` - shared with
// the MCP session module and with `useRiderProfile`, which clamps its
// persisted values against them so the site can never send a profile the
// schemas below refuse.

/**
 * Browsers and `$fetch` both serialize an unset control as `?param=`, which
 * has always meant "no filter" here - and which `z.coerce.number()` would
 * otherwise read as `0`. Mapped to `undefined` before any schema sees it.
 */
const emptyToUndef = (value: unknown) => (value === '' || value === undefined ? undefined : value)

/** Free-text search, normalized the way every handler always has. */
const qSearch = z.preprocess(emptyToUndef, z.string().max(200).optional())
  .transform(value => value?.trim().toLowerCase() || undefined)

/**
 * A numeric parameter. Rejects anything `Number()` can't fully parse -
 * including `Infinity` and a repeated parameter (`?limit=1&limit=2`), both of
 * which the old bare-`Number()` parsing let through as garbage.
 */
const qNumber = z.preprocess(emptyToUndef, z.coerce.number().finite().optional())

/** A `true`/`false` flag. Anything else is a 400, absent means `defaultValue`. */
const qBool = <D extends boolean | undefined>(defaultValue: D) =>
  z.preprocess(emptyToUndef, z.enum(['true', 'false']).optional())
    .transform(value => (value === undefined ? defaultValue : value === 'true'))

/** An optional member of `values`; an unrecognized member is a 400. */
const qEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(emptyToUndef, z.enum(values).optional())

/**
 * `worlds` IS a runtime export of zwift-data, so this enum can't drift from
 * `WorldSlug` - a new world appears here the moment the package updates.
 */
export const WORLD_SLUGS = getWorlds().map(world => world.slug)

const qWorld = z.preprocess(emptyToUndef, z.enum(WORLD_SLUGS as [WorldSlug, ...WorldSlug[]]).optional())

/**
 * The rider's garage: a JSON object mapping frame id to upgrade level, e.g.
 * `{"6":3}`. Malformed JSON or a non-object is a 400 - a garage the rider set
 * up must never be silently dropped, which is exactly what the old
 * swallow-everything parser did. Inside a valid shape it stays lenient:
 * unknown keys simply match no frame, and out-of-range levels clamp to 0-5,
 * because this payload comes from users' persisted localStorage and a stale
 * value must not permanently break their page.
 */
const ownedLevelsSchema = z.preprocess(emptyToUndef, z.string().max(5000).optional())
  .transform((raw, ctx): Record<string, number> => {
    if (raw === undefined) return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      ctx.addIssue({ code: 'custom', message: '`owned` must be a JSON object mapping frame id to upgrade level, e.g. {"6":3}' })
      return z.NEVER
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      ctx.addIssue({ code: 'custom', message: '`owned` must be a JSON object mapping frame id to upgrade level, e.g. {"6":3}' })
      return z.NEVER
    }
    const levels: Record<string, number> = {}
    for (const [frameId, level] of Object.entries(parsed)) {
      if (typeof level !== 'number' || !Number.isFinite(level)) {
        ctx.addIssue({ code: 'custom', message: `\`owned\` level for frame "${frameId}" must be a number between 0 and 5` })
        return z.NEVER
      }
      // Rounded as well as clamped: upgrade stages are whole numbers in
      // Zwift, and whole stages are all the precomputed physics table
      // (shared/data/equipmentPhysics.ts) covers - same semantic
      // normalization family as the laps/TTT snapping documented above.
      levels[frameId] = Math.min(5, Math.max(0, Math.round(level)))
    }
    return levels
  })

/** The rider's wheel garage: a JSON array of wheelset keys, e.g. `["zipp-808"]`. */
const ownedWheelKeysSchema = z.preprocess(emptyToUndef, z.string().max(5000).optional())
  .transform((raw, ctx): Set<string> => {
    if (raw === undefined) return new Set()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      ctx.addIssue({ code: 'custom', message: '`ownedWheels` must be a JSON array of wheelset keys, e.g. ["zipp-808"]' })
      return z.NEVER
    }
    if (!Array.isArray(parsed) || parsed.some(key => typeof key !== 'string')) {
      ctx.addIssue({ code: 'custom', message: '`ownedWheels` must be a JSON array of wheelset keys, e.g. ["zipp-808"]' })
      return z.NEVER
    }
    return new Set(parsed as string[])
  })

export const bikesQuerySchema = z.object({
  search: qSearch,
  category: qEnum(BIKE_CATEGORIES)
})

export const wheelsetsQuerySchema = z.object({
  search: qSearch
})

export const segmentsQuerySchema = z.object({
  search: qSearch,
  world: qWorld
})

export const routesQuerySchema = z.object({
  search: qSearch,
  world: qWorld,
  sport: qEnum(SPORTS),
  minDistance: qNumber,
  maxDistance: qNumber,
  minElevation: qNumber,
  maxElevation: qNumber,
  surface: qEnum(ROUTE_SURFACE_FILTERS),
  eventOnly: qBool(undefined)
})

/**
 * Everything both recommend endpoints share. A plain shape (not a schema) so
 * each endpoint can spread its own extra fields in before the object is
 * closed over the rider-profile refinement below.
 */
const recommendBaseShape = {
  search: qSearch,
  category: qEnum(BIKE_CATEGORIES),
  limit: qNumber.pipe(z.number().min(1).max(9).optional()).transform(value => value ?? 9),
  // Offset feeds `offset + limit + SIMULATED_ORDER_MARGIN` simulations, so
  // its upper bound IS the per-request CPU bound: at the old max of 1000 a
  // single crafted request measurably rode the full 30s `cpu_ms` kill limit
  // (~$0.02/M CPU-ms, 30/min per IP allowed). 100 keeps ~11 "Show more"
  // pages reachable - deeper than any real browsing - at ~154 simulations
  // worst case.
  offset: qNumber.pipe(z.number().min(0).max(100).optional()).transform(value => (value === undefined ? 0 : Math.floor(value))),
  // Defaults to on: an `estimated` score is a name/style heuristic, and a
  // finish time built on one is a much weaker claim than one built on real
  // bot-test data. Callers opt out with `verifiedOnly=false` - which the
  // rider-facing pages send explicitly, so this default and
  // `usePreferences`'s can't drift apart unnoticed. Note it removes the
  // gravel and fun categories entirely, since neither has any measured frame.
  verifiedOnly: qBool(true),
  // Defaults to include: the three purchasable Halo frames stay in the pool
  // unless the caller explicitly sends `includeHalo=false`. The rider-facing
  // pages always send it (and their preference defaults to off - see
  // `includeHaloBikes` in `usePreferences`); the MCP tools and existing API
  // consumers never send it, so their behavior is unchanged by design
  // (issue #112).
  includeHalo: qBool(true),
  ownedOnly: qBool(false),
  owned: ownedLevelsSchema,
  ownedWheels: ownedWheelKeysSchema,
  // How many wheelsets a single frame may occupy in the results. Undefined
  // keeps `capWheelsetsPerFrame`'s own default; a client that wants one row
  // per frame (the fastest wheelset for this route) passes 1. Only ever
  // narrows what is *displayed* - it is applied after ranking, never before,
  // so it can't remove a candidate from consideration.
  maxWheelsetsPerFrame: qNumber.pipe(z.number().min(1).max(99).optional()).transform(value => (value === undefined ? undefined : Math.round(value))),
  // Falls back to the shared constant rather than a local 0, so an
  // unspecified call assumes the same stage the site does - see
  // `DEFAULT_UNOWNED_LEVEL`. The stage changes the ranking, not just the
  // times, so two surfaces disagreeing here recommend different bikes.
  // `useRiderProfile` clamps its persisted copy on load, so the site itself
  // can never send an out-of-range value here.
  // Rounded like the `owned` levels above: whole stages are the domain.
  defaultUnownedLevel: qNumber.pipe(z.number().min(0).max(5).optional()).transform(value => (value === undefined ? DEFAULT_UNOWNED_LEVEL : Math.round(value))),
  weightKg: qNumber.pipe(z.number().min(RIDER_BOUNDS.weightKg.min).max(RIDER_BOUNDS.weightKg.max).optional()),
  heightCm: qNumber.pipe(z.number().min(RIDER_BOUNDS.heightCm.min).max(RIDER_BOUNDS.heightCm.max).optional()),
  wkg: qNumber.pipe(z.number().min(RIDER_BOUNDS.wkg.min).max(RIDER_BOUNDS.wkg.max).optional()),
  physics: qEnum(['dynamic', 'legacy', 'compare'] as const).transform(value => value ?? 'dynamic'),
  // Draft mode (see `physics/draft.ts`). In `ttt` the rider's `wkg` is their own
  // average over the rotation, and the paceline moves at the speed that
  // combined effort produces - roughly a solo rider at 1.38x their power on
  // the flat for an 8-rider team. In `race` the `wkg` is their own race average
  // and a single field-calibrated saving applies; `race` reads NO further query
  // params, which is the whole point of one constant - so its cache key is just
  // `draftMode=race`, and `tttRiders`/`tttClimbWkg` stay TTT-only.
  draftMode: qEnum(['solo', 'ttt', 'race'] as const).transform(value => value ?? 'solo'),
  // Range-checked here; `clampTttRiders`/`clampTttClimbWkg` then only supply
  // the default and snap to the controls' own steps (whole riders, 0.1 W/kg).
  tttRiders: qNumber.pipe(z.number().min(TTT_MIN_RIDERS).max(TTT_MAX_RIDERS).optional()).transform(value => clampTttRiders(value ?? Number.NaN)),
  tttClimbWkg: qNumber.pipe(z.number().min(TTT_MIN_CLIMB_WKG).max(TTT_MAX_CLIMB_WKG).optional()).transform(clampTttClimbWkg)
}

/**
 * The profile is all-or-nothing: absent entirely means "rank by score, no
 * finish times" (unchanged), but a partial one is a caller error - the old
 * code silently dropped into no-profile mode, which read as "the API ignored
 * my weight" rather than "I forgot a parameter".
 */
const riderProfileComplete = (query: { weightKg?: number, heightCm?: number, wkg?: number }, ctx: z.RefinementCtx) => {
  const provided = [query.weightKg, query.heightCm, query.wkg].filter(value => value !== undefined).length
  if (provided > 0 && provided < 3) {
    ctx.addIssue({ code: 'custom', message: 'Pass `weightKg`, `heightCm` and `wkg` together, or none of them' })
  }
}

export const recommendRouteQuerySchema = z.object({
  ...recommendBaseShape,
  // Bounded here; the handler still runs `clampLaps` for the route-dependent
  // parts (a point-to-point route is forced to 1 lap whatever was asked, and
  // the total ride is capped at MAX_TOTAL_DISTANCE_KM - simulation CPU is
  // linear in total distance, so the cap is what keeps a long lappable route
  // from multiplying into an arbitrarily expensive request).
  laps: qNumber.pipe(z.number().min(1).max(MAX_LAPS).optional()),
  // Event race pages send this when the race format outlaws TT frames (Zwift
  // disables them for points and scratch races - see `ttBikesAllowed` in
  // `shared/utils/events.ts`). It's a LEGALITY filter like ownership, not a
  // display trim, and `category` can't express it: a points race allows road
  // AND gravel frames, just never TT.
  excludeTT: qBool(false)
}).superRefine(riderProfileComplete)

export const recommendSegmentQuerySchema = z.object({
  ...recommendBaseShape,
  // The preferred parent route for this segment's surface data. Deliberately
  // loose: an unknown slug falls back to the segment's first hosting route
  // (see `routeWithMetaForSegment`), which client-side navigation relies on.
  route: z.preprocess(emptyToUndef, z.string().max(200).optional())
}).superRefine(riderProfileComplete)

export type RecommendRouteQuery = z.output<typeof recommendRouteQuerySchema>
export type RecommendSegmentQuery = z.output<typeof recommendSegmentQuerySchema>

/**
 * Parses `event`'s query string against `schema`, throwing a 400 whose
 * message names the offending parameter(s) and what they accept. Synchronous
 * on purpose - h3's `getValidatedQuery` would force every handler `async` and
 * its 400 carries the raw `ZodError` JSON blob as the message, where
 * `prettifyError` produces one readable line per problem.
 */
export function parseQuery<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  const result = schema.safeParse(getQuery(event))
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid query parameters',
      message: z.prettifyError(result.error),
      data: { issues: result.error.issues }
    })
  }
  return result.data
}
