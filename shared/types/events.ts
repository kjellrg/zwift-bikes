import type { RouteWithMeta } from './catalog'

/**
 * Scheduled racing series (currently only Zwift Racing League) modelled as
 * data, not as content: a series has seasons, a season has rounds, a round
 * has one race per week.
 *
 * There is no public API for any of this - WTRL publishes the calendar on
 * its own site and ZwiftInsider writes it up per round - so every season
 * file under `shared/data/events/` is hand-curated from those two sources
 * and carries a `sourceUrl` per race for attribution.
 *
 * IMPORTANT: everything reachable from this module must stay free of
 * `shared/utils/catalog` (and therefore of `routeSurfaces.generated.json`,
 * ~2 MB). Races reference a route by `routeSlug` string alone; the join to
 * real route data happens server-side in `server/api/events/[season].get.ts`.
 * That is the same reason the route pages fetch `/api/routes/[slug]` rather
 * than importing the catalog directly.
 */

/**
 * The three formats WTRL runs. This drives the equipment rules rather than
 * being stored alongside them: TT frames are only legal (and only draft) in
 * a team time trial, and are disabled by Zwift itself for points and scratch
 * races - see `ttBikesAllowed`.
 */
export type RaceFormat = 'ttt' | 'points' | 'scratch'

/**
 * Zwift's racing categories, grouped the way WTRL schedules them: A/B and
 * C/D routinely ride the same route for a different number of laps.
 */
export type RaceCategory = 'A' | 'B' | 'C' | 'D'

/**
 * One category group's race. A/B and C/D don't merely ride a different number
 * of laps - in ZRL 2026/27 Round 1 they ride entirely different *routes* twice
 * (Makuri 40 vs Urumaze in week 3, Radio Rendezvous vs a ZRL-exclusive route in
 * week 6). So the route, the laps and the published figures all belong to the
 * group, not to the race.
 *
 * When every category rides the same route over the same laps, that's one group
 * listing all four cats - and the race page then shows no category selector at
 * all, because there is nothing to select between.
 */
/**
 * A segment where a points race awards points.
 *
 * ZRL scores two ways, and the same segment is often used for both: FAL
 * ("first across the line") ranks riders by finishing order through the
 * segment, FTS ("fastest through segment") by elapsed time across it.
 */
export interface RaceScoringSegment {
  /** Name exactly as the organiser publishes it, e.g. `Village FWD Sprint`. */
  name: string
  /**
   * `zwift-data` segment slug, and set **only when this site has a page for
   * it**, because that is what the race page turns into a link.
   *
   * Not every real segment has one: the segment catalog is built from routes
   * that publish positional `segmentsOnRoute` data, and plenty of routes don't
   * (Makuri 40 among them), so its five scoring sprints exist in the game and
   * in `zwift-data` but have no page here. `scripts/validate-events.mjs`
   * enforces the rule in both directions - a slug that has no page is an
   * error, and a segment that gained one is flagged so the link can be added.
   */
  slug?: string
  /** How many times it is scored over the race. Defaults to once. */
  times?: number
}

export interface RaceCategoryGroup {
  /** The categories this applies to, e.g. `['A', 'B']` or all four. */
  cats: RaceCategory[]
  /**
   * `zwift-data` route slug. Undefined when the organiser runs the group on a
   * route the public catalog doesn't contain - ZRL uses unlisted "exclusive"
   * routes - in which case the group is still shown with its published name
   * and figures, but can't be given a bike ranking.
   */
  routeSlug?: string
  /**
   * The course name exactly as the organiser publishes it.
   *
   * Always set, even when `routeSlug` resolves - it's what the slug was mapped
   * *from*, so it both documents the mapping and gives the page a human name
   * without having to join to the catalog first (`zwift-data` has routes whose
   * slug is a bare numeric id, e.g. Urumaze's `4092230492`, which is not
   * something to show a rider). `scripts/validate-events.mjs` compares the two
   * and warns when they diverge, which is how a mis-mapped slug gets caught.
   */
  routeName?: string
  laps: number
  /**
   * Distance/elevation exactly as the organiser publishes them, for this
   * group. Display-only - see the note on the race page: the physics always
   * runs on the route's own geometry, never on these.
   */
  officialDistanceKm?: number
  officialElevationM?: number
  /**
   * Where the points are. Only meaningful for a points race, and only as
   * published - an empty or absent list means the organiser lists no
   * intermediate scoring segments, not that we failed to find any.
   */
  falSegments?: RaceScoringSegment[]
  ftsSegments?: RaceScoringSegment[]
  /**
   * The organiser hasn't published the scoring segments for this group yet,
   * but is expected to.
   *
   * Distinct from an empty list, which asserts there are none. The page shows
   * "TBD" rather than "none listed", because telling a rider a points race has
   * no intermediate points is a factual claim, and one that would be wrong the
   * moment WTRL fills the column in.
   */
  scoringSegmentsTbd?: boolean
}

export interface EventRace {
  /**
   * Stable within a season, and deliberately free of the route name: WTRL
   * has swapped a route after publishing a round, and a slug that encodes
   * the route would either go stale or need a redirect. The route name
   * carries the SEO weight in the title/h1 instead.
   */
  slug: string
  round: number
  week: number
  /** ISO date (`YYYY-MM-DD`) of race day, in WTRL's published calendar. */
  date: string
  /**
   * Undefined while WTRL lists the format as TBC. Since the equipment rules
   * are derived from it, a race without a format can't be given a page any
   * more than one without a route can.
   */
  format?: RaceFormat
  /**
   * One entry per category group. Empty while the round is unannounced.
   *
   * The route, lap count and published figures all live here rather than on
   * the race, because ZRL routinely gives A/B and C/D different ones - see
   * `RaceCategoryGroup`. The first entry is the race's primary group (A/B by
   * convention), and is what the page title, canonical route link and
   * structured data are built from.
   */
  categories: RaceCategoryGroup[]
  /** Free-text summary of powerup placement, as published. */
  powerups?: string
  /**
   * A short hand-written tactical note. Not optional in spirit: it is what
   * keeps a race page from being a template with a route name swapped in.
   */
  note?: string
  /** WTRL or ZwiftInsider page this race's details were taken from. */
  sourceUrl?: string
  /**
   * Retires a race without deleting it. A hidden race disappears from the
   * season calendar, loses its page (direct hits 404), and drops out of the
   * sitemap and the prerender list - but its details stay in the file as a
   * record of what was scheduled.
   *
   * For races that were cancelled, rescheduled onto a different route, or are
   * simply too old to be worth showing. Note that hiding a race that has
   * already been indexed will start returning 404s for a URL search engines
   * know about; that's the intended outcome for genuinely obsolete pages, but
   * it is not free.
   */
  hidden?: boolean
  /** ISO date this entry's details were last edited - drives sitemap `lastmod`. */
  updatedAt: string
}

export interface EventRound {
  number: number
  /** WTRL's own name for the round, e.g. "Fresh & Fast". */
  name?: string
  /** ISO dates of the first and last race in the round. */
  startDate: string
  endDate: string
  races: EventRace[]
}

export interface EventSeason {
  /** URL slug, e.g. `zrl-2026-27`. */
  slug: string
  /** Season label as WTRL writes it, e.g. `2026/27`. */
  label: string
  seriesSlug: string
  seriesName: string
  organizer: string
  organizerUrl: string
  /** One-line description used for the season page's meta description. */
  description: string
  /**
   * Current state of play in the organiser's own words - e.g. that a round's
   * routes are still unpublished. Shown at the top of the season page so a
   * calendar full of TBCs reads as "not announced yet" rather than as missing
   * data.
   */
  note?: string
  /**
   * Retires a whole season - it vanishes from the events hub, its season page
   * and every one of its race pages 404, and none of them appear in the
   * sitemap. The usual case for an old season that's no longer worth showing,
   * without having to hide each race individually.
   */
  hidden?: boolean
  rounds: EventRound[]
}

/**
 * The bits of a route the season calendar actually renders.
 *
 * Deliberately narrower than `RouteSummary`, which carries the route's full
 * measured elevation profile and per-surface segments - ~10 KB per route,
 * none of which a calendar row displays. Multiplied by a fully-announced
 * 24-race season that would be ~250 KB of payload for a table of names.
 */
export type EventRaceRoute = Pick<RouteWithMeta, 'slug' | 'name' | 'world' | 'worldName' | 'distance' | 'elevation'>

/** A category group joined to its route, as returned by `/api/events/[season]`. */
export interface EventRaceCategoryWithRoute extends RaceCategoryGroup {
  /** Absent when `routeSlug` is unset, or names a route the catalog doesn't have. */
  route?: EventRaceRoute
  /** Distance/elevation from this site's own route data, over this group's laps. */
  computed?: {
    laps: number
    distanceKm: number
    elevationM: number
  }
}

/** A race with every category group joined to its route. */
export interface EventRaceWithRoute extends Omit<EventRace, 'categories'> {
  categories: EventRaceCategoryWithRoute[]
}

export interface EventRoundWithRoutes extends Omit<EventRound, 'races'> {
  races: EventRaceWithRoute[]
}

export interface EventSeasonWithRoutes extends Omit<EventSeason, 'rounds'> {
  rounds: EventRoundWithRoutes[]
}
