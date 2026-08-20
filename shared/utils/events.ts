import { z } from 'zod'
import { seasonData } from '../data/events'
import { MAX_LAPS } from './routeLaps'

/**
 * Schema and accessors for the hand-curated racing calendar in
 * `shared/data/events/`.
 *
 * Seasons live as plain JSON, one file per season, validated here through zod
 * once at module init - a broken data file fails the build (the registry is
 * imported by `nuxt.config.ts` for the prerender list) with a path-precise
 * message rather than surfacing as an undefined somewhere in a page.
 *
 * There is no public API for any of this - organisers publish calendars on
 * their own sites and ZwiftInsider writes them up - so every season file is
 * hand-curated from those sources and carries a `sourceUrl` per race for
 * attribution. `docs/events-data.md` walks through the workflow;
 * `scripts/events/validate-events.mjs` checks everything zod can't (route
 * slugs against zwift-data, dates against round ranges, published figures
 * against computed totals).
 *
 * IMPORTANT: everything reachable from this module must stay free of
 * `shared/utils/catalog` (and therefore of `routeSurfaces.generated.json`,
 * ~2 MB). Races reference a route by `routeSlug` string alone; the join to
 * real route data happens server-side in `server/api/events/[season].get.ts`.
 * That is the same reason the route pages fetch `/api/routes/[slug]` rather
 * than importing the catalog directly.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)')

/**
 * The formats run across the covered series (ZRL's four; ZRacing stages are
 * scratch races - GC is by best finishing time). This drives the equipment
 * rules rather than being stored alongside them: TT frames are only legal
 * (and only draft) in a team time trial, and are disabled by Zwift itself for
 * points and scratch races - see `ttBikesAllowed`.
 *
 * `rot` is WTRL's Race of Truth, new for 2026/27: scored exactly like a points
 * race (FAL and FTS at published segments) but ridden with **drafting turned
 * off** and TT frames banned, so it is neither a points race nor a TTT for
 * equipment purposes - see `draftingAllowed`.
 */
export const raceFormatSchema = z.enum(['ttt', 'points', 'scratch', 'rot'])

/**
 * Zwift's lettered racing pens (E is ZRacing legacy / women's E). Not every
 * series uses them - ZRacing 2026 entries are racing-score ranges (Women-Only,
 * Range 1, Range 2, Advanced), which a group models with `label` instead.
 */
export const raceCategorySchema = z.enum(['A', 'B', 'C', 'D', 'E'])

/** Zwift's race powerups, as spelled in event listings. */
export const powerupSchema = z.enum(['feather', 'aero', 'draft', 'ghost', 'anvil', 'steamroller', 'burrito'])

/**
 * A segment where a points race awards points.
 *
 * ZRL scores two ways, and the same segment is often used for both: FAL
 * ("first across the line") ranks riders by finishing order through the
 * segment, FTS ("fastest through segment") by elapsed time across it.
 */
export const raceScoringSegmentSchema = z.strictObject({
  /** Name exactly as the organiser publishes it, e.g. `Village FWD Sprint`. */
  name: z.string().min(1),
  /**
   * `zwift-data` segment slug, and set **only when this site has a page for
   * it**, because that is what the race page turns into a link. The validator
   * enforces the rule in both directions - a slug that has no page is an
   * error, and a segment that gained one is flagged so the link can be added.
   */
  slug: z.string().optional(),
  /** How many times it is scored over the race. Defaults to once. */
  times: z.number().int().min(1).optional(),
  /** Curator-facing commentary (mapping reasoning, sources); never rendered. */
  curatorNote: z.string().optional()
})

/**
 * One category group's race. The route, the laps and the published figures
 * all belong to the group, not to the race: in ZRL 2026/27 Round 1, A/B and
 * C/D ride entirely different *routes* twice (Makuri 40 vs Urumaze in week 3)
 * and different lap counts elsewhere.
 *
 * When every category rides the same route over the same laps, that's one
 * group listing all cats - and the race page then shows no category selector
 * or comparison table at all, because there is nothing to compare.
 */
export const raceCategoryGroupSchema = z.strictObject({
  /** The lettered pens this applies to, e.g. `['A', 'B']`. Empty for series that don't use pens - then `label` is required. */
  cats: z.array(raceCategorySchema),
  /**
   * Display override for the group. Required when `cats` is empty (ZRacing's
   * score-range entries: "Women-Only, Range 1-2, Advanced"); when set it
   * replaces the `A/B`-style pen label everywhere the group is named.
   */
  label: z.string().optional(),
  /**
   * `zwift-data` route slug. Undefined when the organiser runs the group on a
   * route the public catalog doesn't contain - ZRL uses unlisted "exclusive"
   * routes - in which case the group is still shown with its published name
   * and figures, but can't be given a bike ranking.
   */
  routeSlug: z.string().optional(),
  /**
   * The course name exactly as the organiser publishes it.
   *
   * Always set, even when `routeSlug` resolves - it's what the slug was
   * mapped *from*, so it both documents the mapping and gives the page a
   * human name without joining to the catalog first (`zwift-data` has routes
   * whose slug is a bare numeric id, e.g. Urumaze's `4092230492`, which is
   * not something to show a rider). The validator compares the two and warns
   * when they diverge, which is how a mis-mapped slug gets caught.
   */
  routeName: z.string().optional(),
  // Capped at MAX_LAPS: the recommend API rejects lap counts above it, so a
  // race defined beyond the cap would break its own page's ranking fetch.
  laps: z.number().int().min(1).max(MAX_LAPS),
  /**
   * Distance/elevation exactly as the organiser publishes them, for this
   * group. Display-only - see the note on the race page: the physics always
   * runs on the route's own geometry, never on these.
   */
  officialDistanceKm: z.number().positive().optional(),
  officialElevationM: z.number().min(0).optional(),
  /**
   * Where the points are. Only meaningful for a points race, and only as
   * published - an empty or absent list means the organiser lists no
   * intermediate scoring segments, not that we failed to find any.
   */
  falSegments: z.array(raceScoringSegmentSchema).optional(),
  ftsSegments: z.array(raceScoringSegmentSchema).optional(),
  /**
   * The organiser hasn't published the scoring segments for this group yet,
   * but is expected to.
   *
   * Distinct from an empty list, which asserts there are none. The page shows
   * "TBD" rather than "none listed", because telling a rider a points race
   * has no intermediate points is a factual claim, and one that would be
   * wrong the moment the organiser fills the column in.
   */
  scoringSegmentsTbd: z.boolean().optional(),
  /** Curator-facing commentary; never rendered. */
  curatorNote: z.string().optional()
}).refine(group => group.cats.length > 0 || Boolean(group.label), {
  message: 'a category group needs lettered cats or a display label'
})

/**
 * Which powerups the race allows. Absent entirely = the organiser hasn't
 * published powerup rules - the UI then renders nothing at all about
 * powerups, no placeholder. `allowed: []` = explicitly no powerups (a
 * curated fact, rendered as a "No powerups" badge).
 */
export const racePowerupsSchema = z.strictObject({
  allowed: z.array(powerupSchema),
  /** Placement/context detail as published, e.g. "PowerUps are disabled in TTTs". */
  note: z.string().optional()
})

export const eventRaceSchema = z.strictObject({
  /**
   * Stable within a season, and deliberately free of the route name: WTRL
   * has swapped a route after publishing a round, and a slug that encodes
   * the route would either go stale or need a redirect. The route name
   * carries the SEO weight in the title/h1 instead. Per-series conventions
   * (`round-{n}-week-{n}` for ZRL, `stage-{n}` for ZRacing) are generated by
   * the scaffolder and checked as a warning, not an error.
   */
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a kebab-case slug'),
  round: z.number().int().min(1),
  week: z.number().int().min(1),
  /** ISO date (`YYYY-MM-DD`) of race day - or of the window's first day for week-long stages. */
  date: isoDate,
  /** Last day of the window, for stages that run over several days (ZRacing). A race is *past* once `endDate ?? date` is behind today. */
  endDate: isoDate.optional(),
  /**
   * Undefined while the organiser lists the format as TBC. Since the
   * equipment rules are derived from it, a race without a format can't be
   * given a page any more than one without a route can.
   */
  format: raceFormatSchema.optional(),
  /**
   * One entry per category group. Empty while the round is unannounced.
   * The first entry is the race's primary group (A/B by convention), and is
   * what the page title, canonical route link and structured data are built
   * from.
   */
  categories: z.array(raceCategoryGroupSchema),
  powerups: racePowerupsSchema.optional(),
  /**
   * A short hand-written tactical note. Not optional in spirit: it is what
   * keeps a race page from being a template with a route name swapped in.
   */
  note: z.string().optional(),
  /** Curator-facing commentary; never rendered. */
  curatorNote: z.string().optional(),
  /** Organiser or ZwiftInsider page this race's details were taken from. */
  sourceUrl: z.url().optional(),
  /**
   * Retires a race without deleting it. A hidden race disappears from the
   * season calendar, loses its page (direct hits 404), and drops out of the
   * sitemap and the prerender list - but its details stay in the file as a
   * record of what was scheduled.
   */
  hidden: z.boolean().optional(),
  /** ISO date this entry's details were last edited - drives sitemap `lastmod`. */
  updatedAt: isoDate
})

export const eventRoundSchema = z.strictObject({
  number: z.number().int().min(1),
  /** The organiser's own name for the round, e.g. "Fresh & Fast" - or the month + theme for ZRacing ("August: Makuri Madness"). */
  name: z.string().optional(),
  /** ISO dates of the first and last race day in the round. */
  startDate: isoDate,
  endDate: isoDate,
  races: z.array(eventRaceSchema)
})

export const eventSeasonSchema = z.strictObject({
  /** URL slug, e.g. `zrl-2026-27`. */
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a kebab-case slug'),
  /** Season label as the organiser writes it, e.g. `2026/27`. */
  label: z.string().min(1),
  seriesSlug: z.string().min(1),
  seriesName: z.string().min(1),
  organizer: z.string().min(1),
  /** The organiser's own page for the series - we complement the original sources, so link back to them prominently. */
  organizerUrl: z.url().optional(),
  /** One-line description used for the season page's meta description. */
  description: z.string().min(1),
  /**
   * Current state of play in the organiser's own words - e.g. that a round's
   * routes are still unpublished. Shown at the top of the season page so a
   * calendar full of TBCs reads as "not announced yet" rather than as
   * missing data.
   */
  note: z.string().optional(),
  /** Curator-facing commentary; never rendered. */
  curatorNote: z.string().optional(),
  /** Where this season's data was curated from, and when each was last checked. */
  sources: z.array(z.strictObject({ url: z.url(), checkedAt: isoDate })).optional(),
  /**
   * Retires a whole season - it vanishes from the events hub, its season
   * page and every one of its race pages 404, and none of them appear in
   * the sitemap.
   */
  hidden: z.boolean().optional(),
  rounds: z.array(eventRoundSchema)
})

export type RaceFormat = z.infer<typeof raceFormatSchema>
export type RaceCategory = z.infer<typeof raceCategorySchema>
export type Powerup = z.infer<typeof powerupSchema>
export type RaceScoringSegment = z.infer<typeof raceScoringSegmentSchema>
export type RaceCategoryGroup = z.infer<typeof raceCategoryGroupSchema>
export type RacePowerups = z.infer<typeof racePowerupsSchema>
export type EventRace = z.infer<typeof eventRaceSchema>
export type EventRound = z.infer<typeof eventRoundSchema>
export type EventSeason = z.infer<typeof eventSeasonSchema>

/**
 * Validated once at module init. A schema violation throws here with the
 * season file and JSON path in the message - this module is imported by
 * `nuxt.config.ts`, so bad data can never survive to a built site.
 */
const seasons: EventSeason[] = seasonData.map((season) => {
  const parsed = eventSeasonSchema.safeParse(season)
  if (!parsed.success) {
    const slug = (season as { slug?: string })?.slug ?? '<unknown season>'
    const issues = parsed.error.issues
      .map(issue => `  ${slug}.${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid event season data in shared/data/events:\n${issues}`)
  }
  return parsed.data
})

/**
 * Every season, hidden ones included. Only for tooling that has to check
 * data it isn't going to display - the validator still validates a retired
 * season, since `hidden` is a display decision and shouldn't be a way to
 * smuggle broken data past the build. Everything user-facing wants
 * `getSeasons()`.
 */
export function getAllSeasons(): EventSeason[] {
  return seasons
}

export function getSeasons(): EventSeason[] {
  return seasons.filter(season => !season.hidden)
}

export function getSeasonBySlug(slug: string): EventSeason | undefined {
  return getSeasons().find(season => season.slug === slug)
}

/** Every race in a season in calendar order, hidden ones included. */
export function getSeasonRaces(season: EventSeason): EventRace[] {
  return season.rounds.flatMap(round => round.races)
}

/** Every race a visitor should see - the calendar, "next race", and so on. */
export function getVisibleSeasonRaces(season: EventSeason): EventRace[] {
  return getSeasonRaces(season).filter(race => !race.hidden)
}

export function getRaceBySlug(seasonSlug: string, raceSlug: string): EventRace | undefined {
  const season = getSeasonBySlug(seasonSlug)
  if (!season) return undefined
  return getSeasonRaces(season).find(race => race.slug === raceSlug)
}

export function getRoundForRace(season: EventSeason, race: EventRace): EventRound | undefined {
  return season.rounds.find(round => round.races.some(r => r.slug === race.slug))
}

/**
 * A race earns its own page only once the organiser has published the route,
 * the format and the lap counts. Without a route there is nothing to
 * recommend a bike for; without a format the equipment rules
 * (`ttBikesAllowed`) are unknown; and without lap counts the distance shown
 * - and the geometry the physics runs on - would silently be one lap of a
 * route that's raced over six. Any of those missing means no page and no
 * sitemap entry, rather than a thin or wrong one.
 *
 * `hidden` is checked here too, so retiring a race takes it out of the
 * pages, the prerender list and the sitemap through the same single gate
 * rather than needing each of those to remember about it separately.
 *
 * At least *one* category group has to name a route the catalog knows. ZRL
 * sometimes runs a group on an unlisted "exclusive" route (Round 1 Week 6
 * for C/D), which can't be ranked - but the race still earns its page off
 * the groups that can be, and the odd one out is shown with its published
 * figures and an explanation.
 */
export function isRacePublishable(race: EventRace): race is EventRace & { format: NonNullable<EventRace['format']> } {
  return !race.hidden
    && Boolean(race.format)
    && race.categories.length > 0
    && race.categories.some(group => Boolean(group.routeSlug))
}

export interface PublishableRace {
  season: EventSeason
  round: EventRound
  race: EventRace
  /** Site-absolute path of the race page. */
  path: string
}

/**
 * Every race that currently has a page, across all visible seasons. The
 * single source for both the sitemap (`server/api/__sitemap__/urls.ts`) and
 * the prerender list (`nuxt.config.ts`), so the two can't drift - the same
 * rule the route pages already follow.
 */
export function getPublishableRaces(): PublishableRace[] {
  return getSeasons().flatMap(season =>
    season.rounds.flatMap(round =>
      round.races
        .filter(isRacePublishable)
        .map(race => ({ season, round, race, path: `/events/${season.slug}/${race.slug}` }))
    )
  )
}

/**
 * Zwift disables TT frames for points and scratch races and enables them
 * (with draft) for team time trials, so the format alone decides this - see
 * WTRL's ZRL rules. Unknown format is treated as "not allowed", matching the
 * majority case and the safer assumption for a rider packing a bike.
 *
 * A Race of Truth is the case that looks like it should be an exception and
 * isn't: drafting is off, which in Zwift is normally the TT bike's argument,
 * but WTRL bans TT frames in it outright, so it stays with the majority.
 */
export function ttBikesAllowed(race: EventRace): boolean {
  return race.format === 'ttt'
}

/**
 * Drafting is off only in WTRL's Race of Truth - every other covered format is
 * a draft-legal mass start, or a TTT where the whole point is the rotation. A
 * race page uses this to rank on solo physics regardless of the rider's saved
 * draft preference, which it deliberately leaves untouched.
 */
export function draftingAllowed(race: EventRace): boolean {
  return race.format !== 'rot'
}

/**
 * The category group at `groupIndex`, falling back to the first one the
 * organiser lists (A/B by convention), which is the race's primary group -
 * the one the page title, the canonical route link and the structured data
 * are built from.
 */
export function categoryGroup(race: EventRace, groupIndex = 0): RaceCategoryGroup | undefined {
  return race.categories[groupIndex] ?? race.categories[0]
}

/** The lap count for a category group, defaulting to a single lap. */
export function lapsForCategoryGroup(race: EventRace, groupIndex = 0): number {
  return categoryGroup(race, groupIndex)?.laps ?? 1
}

/**
 * The race's primary route - the first group's, skipping any leading groups
 * on a route the catalog doesn't have, so a race whose A/B route is unlisted
 * still titles itself off a route that exists.
 */
export function primaryRouteSlug(race: EventRace): string | undefined {
  return race.categories.find(group => group.routeSlug)?.routeSlug
}

/**
 * True when the groups don't all ride the same course over the same laps -
 * week 2 (same route, different laps) and weeks 3/6 (different routes) of
 * ZRL 2026/27 Round 1, for instance. The season calendar uses this to show
 * the second course rather than silently listing only A/B's, and the race
 * page uses it to render the per-group comparison table.
 */
export function hasSplitCourses(race: EventRace): boolean {
  const courses = new Set(race.categories.map(group => `${group.routeSlug ?? group.routeName ?? ''}#${group.laps}`))
  return courses.size > 1
}

/**
 * How a group is named everywhere it's shown: the curated `label` when set
 * (score-range series), otherwise `['A','B']` -> `'A/B'`, the way WTRL
 * writes it.
 */
export function formatCategoryGroup(group: Pick<RaceCategoryGroup, 'cats' | 'label'>): string {
  return group.label ?? group.cats.join('/')
}

/** The race's last day - `date` itself for single-day races. */
export function raceEndDate(race: EventRace): string {
  return race.endDate ?? race.date
}

/**
 * How a race is named in headings and structured data: `Stage 3` for
 * ZRacing-convention slugs, `Round 1 Week 3` otherwise. Derived from the
 * slug rather than a per-series flag because the slug already IS the curated
 * per-series naming convention (see the scaffolder) - a second field saying
 * the same thing would just be one more thing to keep in sync.
 */
export function raceDisplayName(race: EventRace): string {
  const stage = /^stage-(\d+)$/.exec(race.slug)
  return stage ? `Stage ${stage[1]}` : `Round ${race.round} Week ${race.week}`
}

/**
 * Sorts by race day. Used for "next race" lookups, which must only ever run
 * client-side: these pages are prerendered, so resolving "next" at render
 * time would freeze a build-time answer into the shipped HTML.
 */
export function sortRacesByDate(races: EventRace[]): EventRace[] {
  return [...races].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Upcoming publishable races that run on the given route, soonest first -
 * the route page's "Featured in" cross-link. `today` is an ISO date and must
 * come from the client (the route pages are prerendered; resolving "today"
 * during render would bake the build date into the HTML).
 */
export function getUpcomingEventsForRoute(routeSlug: string, today: string): PublishableRace[] {
  return getPublishableRaces()
    .filter(({ race }) => raceEndDate(race) >= today
      && race.categories.some(group => group.routeSlug === routeSlug))
    .sort((a, b) => a.race.date.localeCompare(b.race.date))
}

/** The next upcoming publishable race across all series, if any - the homepage teaser. Same client-only `today` rule as above. */
export function getNextUpcomingRace(today: string): PublishableRace | undefined {
  return getPublishableRaces()
    .filter(({ race }) => raceEndDate(race) >= today)
    .sort((a, b) => a.race.date.localeCompare(b.race.date))[0]
}
