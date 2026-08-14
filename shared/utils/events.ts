import type { EventRace, EventRound, EventSeason, RaceCategoryGroup } from '../types/events'
import { zrl202627 } from '../data/events/zrl-2026-27'

/**
 * Accessors over the hand-curated racing calendar in `shared/data/events/`.
 *
 * Deliberately a leaf module: it must never import `./catalog`, which pulls
 * in `routeSurfaces.generated.json` (~2 MB). Pages import this directly for
 * calendar metadata and fetch route/recommendation data over the existing
 * API endpoints, so none of that surface data can reach the client bundle.
 */

const seasons: EventSeason[] = [zrl202627]

/**
 * Every season, hidden ones included. Only for tooling that has to check data
 * it isn't going to display - `scripts/validate-events.mjs` still validates a
 * retired season, since `hidden` is a display decision and shouldn't be a way
 * to smuggle broken data past the build. Everything user-facing wants
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
 * A race earns its own page only once WTRL has published the route, the
 * format and the lap counts. Without a route there is nothing to recommend a
 * bike for; without a format the equipment rules (`ttBikesAllowed`) are
 * unknown; and without lap counts the distance shown - and the geometry the
 * physics runs on - would silently be one lap of a route that's raced over
 * six. Any of those missing means no page and no sitemap entry, rather than
 * a thin or wrong one.
 *
 * `hidden` is checked here too, so retiring a race takes it out of the pages,
 * the prerender list and the sitemap through the same single gate rather than
 * needing each of those to remember about it separately.
 *
 * At least *one* category group has to name a route the catalog knows. ZRL
 * sometimes runs a group on an unlisted "exclusive" route (Round 1 Week 6 for
 * C/D), which can't be ranked - but the race still earns its page off the
 * groups that can be, and the odd one out is shown with its published figures
 * and an explanation.
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
 * Every race that currently has a page, across all visible seasons. The single
 * source for both the sitemap (`server/api/__sitemap__/urls.ts`) and the
 * prerender list (`nuxt.config.ts`), so the two can't drift - the same rule the
 * route pages already follow.
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
 */
export function ttBikesAllowed(race: EventRace): boolean {
  return race.format === 'ttt'
}

/**
 * The category group at `groupIndex`, falling back to the first one WTRL lists
 * (A/B by convention), which is the race's primary group - the one the page
 * title, the canonical route link and the structured data are built from.
 */
export function categoryGroup(race: EventRace, groupIndex = 0): RaceCategoryGroup | undefined {
  return race.categories[groupIndex] ?? race.categories[0]
}

/** The lap count for a category group, defaulting to a single lap. */
export function lapsForCategoryGroup(race: EventRace, groupIndex = 0): number {
  return categoryGroup(race, groupIndex)?.laps ?? 1
}

/**
 * The race's primary route - the first group's, skipping any leading groups on
 * a route the catalog doesn't have, so a race whose A/B route is unlisted still
 * titles itself off a route that exists.
 */
export function primaryRouteSlug(race: EventRace): string | undefined {
  return race.categories.find(group => group.routeSlug)?.routeSlug
}

/**
 * True when the groups don't all ride the same route - week 3 and week 6 of
 * ZRL 2026/27 Round 1, for instance. The season calendar uses this to show the
 * second route rather than silently listing only A/B's.
 */
export function hasSplitRoutes(race: EventRace): boolean {
  const names = new Set(race.categories.map(group => group.routeSlug ?? group.routeName ?? ''))
  return names.size > 1
}

/** `['A','B']` -> `'A/B'`, the way WTRL writes it. */
export function formatCategoryGroup(cats: string[]): string {
  return cats.join('/')
}

/**
 * Sorts by race day. Used for "next race" lookups, which must only ever run
 * client-side: these pages are prerendered, so resolving "next" at render
 * time would freeze a build-time answer into the shipped HTML.
 */
export function sortRacesByDate(races: EventRace[]): EventRace[] {
  return [...races].sort((a, b) => a.date.localeCompare(b.date))
}
