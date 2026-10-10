import type { RouteWithMeta } from '../../types/catalog'
import {
  categoryGroup,
  formatCategoryGroup,
  getRoundForRace,
  hasBeenRun,
  hasSplitCourses,
  POWERUP_LABELS,
  raceContextLabel,
  raceDisplayName,
  raceRouteNames,
  type EventRace,
  type EventSeason,
  type RaceCategoryGroup,
  type RaceFormat
} from '../events'
import { formatRaceDate, formatRaceDateRange } from '../raceDates'
import { raceFormatRules, type RaceFormatRules } from '../raceRules'
import { rideRulesForFormat, type Ride } from '../recommendQuery'
import { climbCountFact, distanceLabel, namedClimbCounts, surfaceCoverageNote, surfaceSplit, type RideFact } from '../rideFacts'
import { computeRouteTotals } from '../routeLaps'
import { expandClimbsForLaps, expandSprintsForLaps } from '../routeOccurrences'
import { runRaceNotice, type RunRaceNotice } from '../runRaceNotice'
import { formatDistance, formatElevation } from '../units'
import type { RideStatementAnswer, RideStatementBase } from './types'

/** A race with a page: one whose organiser has published its format. */
export type RaceWithFormat = EventRace & { format: RaceFormat }

export interface RaceStatementInputs {
  season: EventSeason
  race: RaceWithFormat
  /** The Category group selected - the page's own selection. */
  groupIndex: number
  /**
   * The selected group's course, once looked up; absent for a group racing a
   * route the catalog does not have. A course that is not the group's (a
   * lookup still answering for the group selected before) is no course.
   */
  course: RouteWithMeta | undefined
  /** The day the page is rendered or read on, as `hasBeenRun` takes it. */
  today: string
  siteUrl: string
  answer?: RideStatementAnswer
}

/** One scoring segment, merged across the organiser's FAL and FTS lists. */
export interface ScoringRow {
  name: string
  /** Set where this site has a page for the segment. */
  slug?: string
  /** How often it is scored by finishing order through it (FAL), and by elapsed time across it (FTS). */
  fal: number
  fts: number
  /** Where each pass falls along the ride, in km, in ride order; empty where the route data does not say. */
  positionsKm: number[]
}

export interface RaceStatement extends RideStatementBase {
  kind: 'race'
  rules: RaceFormatRules
  /** The selected Category group, by its organiser's name for it ("A/B"). */
  groupLabel: string
  /** The selected group's course, whether or not the catalog has it. */
  routeName: string
  /** Every course the race's groups ride, joined: "Makuri 40 & Urumaze". */
  routeNamesLabel: string
  /** Each group's course: "A/B on Makuri 40, C/D on Urumaze". */
  routeNamesByCategory: string
  /** Whether the groups differ in route or laps - what earns the per-group course table its place. */
  coursesDiffer: boolean
  /** The race day, or its window. */
  dateLabel: string
  /** The Rider card's fixed lap count, and why it is fixed. */
  fixedLaps: { label: string, reason: string }
  /** Beneath the Fact row, where the surfaces are not mapped. */
  coverageNote: string | undefined
  /** Where the organiser's published figures disagree with the course, both are given. */
  officialFiguresNote: string | undefined
  /** Where the points are, for the selected group. */
  scoring: {
    rows: ScoringRow[]
    /** The scoring segments that have a page here, starred on the Course hero. */
    starredSlugs: string[]
    /** The organiser has yet to publish them - a different thing from listing none. */
    tbd: boolean
    /** Whether there is anything to say about scoring at all: a scratch race scores nothing along the way. */
    shown: boolean
  }
  /** "PowerUps: Feather, Aero." - absent where the organiser has published nothing about them. */
  powerupsLine: string | undefined
  /** Whether the race has been run on `today`. */
  hasRun: boolean
  /** What the page says above its title once it has been run. */
  runNotice: RunRaceNotice | undefined
  /** The share card's own text (`EventCard`), or none once the race has been run. */
  shareCard: {
    props: { series: string, title: string, course: string, date: string }
    /** Whether the card names rank 1's setup - not when the groups ride different routes. */
    namesSetup: boolean
    alt: string
  } | undefined
}

/**
 * The Ride a Category group races: its course and laps and every rule the
 * Race format fixes. No Ride for a group on a route the catalog does not
 * have, which nothing can be ranked for.
 */
export function raceRide(race: RaceWithFormat, groupIndex: number): Ride | undefined {
  const group = categoryGroup(race, groupIndex)
  if (!group?.routeSlug) return undefined
  return { course: { kind: 'route', slug: group.routeSlug }, laps: group.laps, ...rideRulesForFormat(race.format) }
}

/**
 * Whether the organiser's published distance or elevation disagrees with the
 * site's own totals for the course (lead-in plus laps of real route data):
 * by 0.15 km or 5 m or more. One absolute rule for the page, its twin and
 * the events validator, which warns on it.
 */
export function officialFiguresDiffer(
  group: Pick<RaceCategoryGroup, 'officialDistanceKm' | 'officialElevationM'>,
  totals: { distanceKm: number, elevationM: number }
): boolean {
  const distanceOff = group.officialDistanceKm !== undefined && Math.abs(group.officialDistanceKm - totals.distanceKm) >= 0.15
  const elevationOff = group.officialElevationM !== undefined && Math.abs(group.officialElevationM - totals.elevationM) >= 5
  return distanceOff || elevationOff
}

/**
 * The scoring segments of one group in the order the rider meets them.
 *
 * ZRL usually scores the same sprint both ways, so the two published lists
 * are merged into one row per segment rather than printed twice. Each row's
 * passes come from the same lap-expanded occurrences the profile and the
 * climb and sprint cards use, so a "2x" in the table and two starred markers
 * on the profile are the same two passes. A points race is ridden in course
 * order, not in the order the organiser listed the segments; a segment with
 * no position sorts last, keeping its published order among them.
 */
export function scoringRows(group: RaceCategoryGroup | undefined, course: RouteWithMeta | undefined): ScoringRow[] {
  if (!group) return []
  const rows = new Map<string, Omit<ScoringRow, 'positionsKm'>>()
  const add = (list: RaceCategoryGroup['falSegments'], key: 'fal' | 'fts') => {
    for (const segment of list ?? []) {
      const row = rows.get(segment.name) ?? { name: segment.name, slug: segment.slug, fal: 0, fts: 0 }
      row[key] += segment.times ?? 1
      row.slug ??= segment.slug
      rows.set(segment.name, row)
    }
  }
  add(group.falSegments, 'fal')
  add(group.ftsSegments, 'fts')

  const positions = new Map<string, number[]>()
  if (course) {
    for (const occurrence of [...expandSprintsForLaps(course, group.laps), ...expandClimbsForLaps(course, group.laps)]) {
      positions.set(occurrence.slug, [...positions.get(occurrence.slug) ?? [], occurrence.rideFromKm])
    }
  }
  return [...rows.values()]
    .map(row => ({ ...row, positionsKm: row.slug ? [...positions.get(row.slug) ?? []].sort((a, b) => a - b) : [] }))
    .sort((a, b) => (a.positionsKm[0] ?? Infinity) - (b.positionsKm[0] ?? Infinity))
}

/**
 * A race page's Ride statement, for the selected Category group. Everything
 * a route page cannot know is here: the format's rules, the group's laps,
 * where the points are, the PowerUps and what the organiser published. The
 * title and descriptions name every course the race's groups ride, so they
 * read the same whichever group is selected - a split race would otherwise
 * advertise only A/B's course.
 */
export function raceStatement({ season, race, groupIndex, course: lookedUp, today, siteUrl }: RaceStatementInputs): RaceStatement {
  const group = categoryGroup(race, groupIndex)
  const course = lookedUp && group?.routeSlug === lookedUp.slug ? lookedUp : undefined
  const laps = group?.laps ?? 1
  const rules = raceFormatRules(rideRulesForFormat(race.format))!
  const round = getRoundForRace(season, race)
  const raceHeading = raceDisplayName(race)
  // Named under its round ("ZRacing 2026 - August: Makuri Madness Stage 4"):
  // the round name is what riders search for.
  const raceTitle = `${raceContextLabel(season, round)} ${raceHeading}`
  const groupLabel = formatCategoryGroup(group ?? { cats: [] })
  const routeName = group?.routeName ?? course?.name ?? 'Route TBC'
  const routeNamesLabel = raceRouteNames(race).join(' & ') || 'Route TBC'
  const routeNamesByCategory = race.categories
    .map(entry => `${formatCategoryGroup(entry)} on ${entry.routeName ?? 'a route to be confirmed'}`)
    .join(', ')
  const coursesDiffer = hasSplitCourses(race)
  const raceDate = formatRaceDate(race.date)
  const hasRun = hasBeenRun(race, today)

  const totals = course ? computeRouteTotals(course, laps) : undefined
  const distanceKm = totals?.distanceKm ?? group?.officialDistanceKm
  const elevationM = totals?.elevationM ?? group?.officialElevationM
  const climbs = course ? climbCountFact(namedClimbCounts(course.terrain)) : undefined
  const facts: RideFact[] = [
    ...(distanceKm !== undefined ? [{ value: formatDistance(distanceKm), label: distanceLabel({ leadInKm: totals?.leadInDistanceKm ?? 0 }) }] : []),
    ...(elevationM !== undefined ? [{ value: formatElevation(elevationM), label: 'of climbing' }] : []),
    { value: String(laps), label: laps === 1 ? 'lap' : 'laps' },
    ...(course ? [{ value: `${course.terrain.climbRatio.toFixed(1)} m/km`, label: 'climb ratio' }] : []),
    ...(climbs ? [climbs] : [])
  ]

  // Both are shown when they differ rather than quietly picking one: the
  // official figure is what riders see in the event listing, and the site's
  // is what the physics runs on. ZwiftInsider's ZRacing figures run ~2 km
  // over route data, consistent with an event-pen lead-in.
  const published = group && [
    group.officialDistanceKm ? formatDistance(group.officialDistanceKm) : undefined,
    group.officialElevationM !== undefined ? formatElevation(group.officialElevationM) : undefined
  ].filter(Boolean).join(' / ')
  const officialFiguresNote = group && totals && officialFiguresDiffer(group, totals)
    ? `${season.organizer} publishes this race as ${published}; the figures above are this site's own totals from the route's lead-in and lap data, which is what the physics runs on.`
    : undefined

  const rows = scoringRows(group, course)
  const tbd = Boolean(group?.scoringSegmentsTbd)
  // A points race with nothing listed is a real, published state, worth
  // saying out loud rather than an empty table that looks like a failure.
  const scoresWithoutSegments = (race.format === 'points' || race.format === 'rot') && !rows.length

  // Curated fact only: absent PowerUp data is nothing to say; `allowed: []`
  // is explicitly none.
  const powerups = race.powerups
  const powerupsLine = powerups
    ? `PowerUps: ${powerups.allowed.length ? powerups.allowed.map(powerup => POWERUP_LABELS[powerup]).join(', ') : 'none'}${powerups.note ? ` - ${powerups.note}` : ''}.`
    : undefined

  // One setup on the card would be wrong for most readers where the groups
  // ride different ROUTES - narrower than `coursesDiffer`, which also splits
  // on lap count: the same route over more laps is the same terrain mix.
  const cardRouteCount = new Set(race.categories.map(entry => entry.routeSlug ?? entry.routeName ?? '')).size

  return {
    kind: 'race',
    // The course and world only, as a route's: the answer's scope line states
    // the Category group's lap count (issue #291).
    rideName: course ? `${course.name} in ${course.worldName}` : routeName,
    question: `What bike should I ride for ${raceTitle}?`,
    title: `Fastest bike for ${raceTitle}: ${routeNamesLabel} (${rules.label}) | ZwiftBikes`,
    description: coursesDiffer
      ? `${raceTitle}: ${rules.label} on ${raceDate} – ${routeNamesByCategory}. Lap counts per category, TT bike rules, and the best legal bike and wheel combo for each course.`
      : `${raceTitle}: ${rules.label} on ${routeNamesLabel}, ${raceDate}. Lap counts per category, TT bike rules, and the best legal bike and wheel combo.`,
    ogTitle: `Fastest bike for ${raceHeading} – ${routeNamesLabel}`,
    ogDescription: coursesDiffer
      ? `The fastest legal bike and wheel combo for ${raceTitle} – ${routeNamesByCategory}.`
      : `The fastest legal bike and wheel combo for ${raceTitle} on ${routeNamesLabel}.`,
    heading: {
      name: `${raceHeading}: ${routeName}`,
      crumbs: [
        { label: 'Events', to: '/events' },
        { label: `${season.seriesName} ${season.label}`, to: `/events/${season.slug}` },
        { label: rules.label },
        { label: race.endDate ? formatRaceDateRange(race.date, race.endDate) : raceDate }
      ]
    },
    // The deepest trail on the site: a race under its season under the events
    // hub. None for a group with no catalog route, which ranks nothing to
    // answer for.
    breadcrumbs: course
      ? [
          { name: 'Home', item: siteUrl },
          { name: 'Events', item: `${siteUrl}/events` },
          { name: `${season.seriesName} ${season.label}`, item: `${siteUrl}/events/${season.slug}` },
          { name: raceHeading, item: `${siteUrl}/events/${season.slug}/${race.slug}` }
        ]
      : undefined,
    reportItem: `${raceTitle}${course ? ` (${course.name})` : ''}`,
    reportSubject: course ? groupLabel : undefined,
    facts,
    surface: surfaceSplit(course?.surface.composition),
    rules,
    groupLabel,
    routeName,
    routeNamesLabel,
    routeNamesByCategory,
    coursesDiffer,
    dateLabel: race.endDate ? formatRaceDateRange(race.date, race.endDate) : raceDate,
    fixedLaps: {
      label: `${laps} lap${laps === 1 ? '' : 's'}`,
      reason: group && race.categories.length > 1 ? `Set by the ${groupLabel} race group` : 'Set by the race'
    },
    coverageNote: course ? surfaceCoverageNote(course.surface) : undefined,
    officialFiguresNote,
    scoring: {
      rows,
      starredSlugs: [...new Set(rows.map(row => row.slug).filter((slug): slug is string => Boolean(slug)))],
      tbd,
      shown: rows.length > 0 || scoresWithoutSegments || tbd
    },
    powerupsLine,
    hasRun,
    runNotice: hasRun ? runRaceNotice(season, race, today) : undefined,
    // A card is only generated for a prerendered page, and a run race's page
    // is not: it shares the site's own card instead.
    shareCard: hasRun
      ? undefined
      : {
          props: { series: raceContextLabel(season, round), title: raceHeading, course: `${routeNamesLabel} · ${rules.label}`, date: raceDate },
          namesSetup: cardRouteCount <= 1,
          alt: `${raceTitle} on ${routeNamesLabel}: date, format and the fastest legal bike and wheel setup`
        }
  }
}
