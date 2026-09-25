import { groupRoundsByAnnouncement, hasBeenRun, isRacePublishable, raceEndDate, raceNameInRound, raceWhen, roundState, sortRacesByDate, type EventRace, type EventRound, type EventSeason, type RaceWhen } from '#shared/utils/events'
import { formatRaceDateShort } from './labels'

/** A race on the events hub's list, with the season it links under and the tag its row carries. */
export interface HubRace<Race> {
  seasonSlug: string
  tag: string
  race: Race
}

/** One of the hub's date groups, with the races in it by date. */
export interface HubRaceGroup<Race> {
  when: RaceWhen
  title: string
  races: HubRace<Race>[]
}

const GROUP_TITLES: Record<RaceWhen, string> = {
  'on-now': 'On now',
  'next-7-days': 'Next 7 days',
  'later': 'Later'
}

/**
 * The events hub's list: every Race still to run across the Seasons handed
 * in, as one list by date, grouped on now, in the next seven days and later
 * (`raceWhen`). A group with nothing in it is left out.
 *
 * Only races with a page (`isRacePublishable`): the hub is the way to a
 * ranking, and a race without one has nothing to go to. The series boxes
 * under the list say what the organisers have yet to announce, and which
 * races we can't rank.
 *
 * Generic over the race shape, so the hub can hand in the calendars joined
 * to their routes and get those races back to draw.
 */
export function hubRaceGroups<Race extends EventRace>(
  seasons: { slug: string, seriesTag: string, rounds: { races: Race[] }[] }[],
  today: string
): HubRaceGroup<Race>[] {
  const listed = seasons.flatMap(season => season.rounds.flatMap(round => round.races
    .filter(race => isRacePublishable(race) && raceWhen(race, today))
    .map(race => ({ seasonSlug: season.slug, tag: season.seriesTag, race, date: race.date }))))
  const byDate = sortRacesByDate(listed)
  return (Object.keys(GROUP_TITLES) as RaceWhen[])
    .map(when => ({
      when,
      title: GROUP_TITLES[when],
      races: byDate.filter(entry => raceWhen(entry.race, today) === when).map(({ seasonSlug, tag, race }) => ({ seasonSlug, tag, race }))
    }))
    .filter(group => group.races.length > 0)
}

/** Whole UTC days from one ISO date to another. */
function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** `Mon`, pinned to en-GB and UTC as every race date is (see `formatRaceDate`). */
function weekday(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
}

/**
 * The line under a hub row's date that says how far off the race is from
 * `today`: "today", "tomorrow" or "in 5 days" for a one-day race; "ends Sun"
 * for a stage on now, and "starts Mon" for one still to come. A stage gets a
 * weekday only within the coming week, where it can mean one day alone, and
 * a count of days further out. Nothing for a race that has been run.
 *
 * The hub shows it only once the page is on the rider's screen: the served
 * HTML is the build's, and "tomorrow" would be wrong the day after.
 */
export function relativeRaceDay(race: Pick<EventRace, 'date' | 'endDate'>, today: string): string | undefined {
  if (hasBeenRun(race, today)) return undefined
  const end = raceEndDate(race)
  const stage = end !== race.date
  const inDays = (days: number, date: string) => days === 1 ? 'tomorrow' : days < 7 && stage ? weekday(date) : `in ${days} days`

  if (race.date <= today) {
    if (!stage) return 'today'
    const days = daysFrom(today, end)
    return `ends ${days === 0 ? 'today' : inDays(days, end)}`
  }
  const days = daysFrom(today, race.date)
  return stage ? `starts ${inDays(days, race.date)}` : inDays(days, race.date)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * A Round as a sentence starts on it, and whether the verb after it is
 * plural. A monthly series names its rounds "September: Zwift Racing
 * Powered by DURA-ACE" (see `docs/events-data.md`), and riders know those as
 * that month's stages, not as round 9; the rest go by number and name.
 */
function roundSubject(round: Pick<EventRound, 'number' | 'name'>): { subject: string, plural: boolean, month?: number } {
  const monthly = round.name ? /^(\w+): (.+)$/.exec(round.name) : null
  const month = monthly ? MONTHS.indexOf(monthly[1]!) : -1
  if (monthly && month >= 0) return { subject: `${monthly[1]}'s stages, ${monthly[2]},`, plural: true, month }
  return { subject: round.name ? `Round ${round.number}, ${round.name},` : `Round ${round.number}`, plural: false }
}

/** `A`, `A and B`, `A, B and C`. */
function joinNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? ''
}

/**
 * What a round's races still to run say about it that the list above does
 * not: which of them we can't rank, and which the organiser hasn't announced.
 *
 * A race with a format and a named course that still has no page is on a
 * course outside the public catalog - WTRL's own "exclusive" routes, which is
 * why it is the series' own route. The same test as the one a season page's
 * row gives its reason by (`RaceCard`). Anything else without a page is
 * still to be announced.
 */
function roundNotes(round: EventRound, left: EventRace[], organizer: string, tag: string): string[] {
  if (!left.length || groupRoundsByAnnouncement([round]).unannounced.length) return [`${organizer} hasn't announced its routes yet.`]
  const unpublished = left.filter(race => !isRacePublishable(race))
  const unrankable = unpublished.filter(race => race.format && race.categories.some(group => group.routeName))
  const unannounced = unpublished.filter(race => !unrankable.includes(race))
  const notes: string[] = []
  if (unrankable.length === 1) {
    const race = unrankable[0]!
    const last = round.races.filter(r => !r.hidden).at(-1) === race
    notes.push(`${last ? 'Its last race' : raceNameInRound(race)} is on a ${tag}-only route, so we can't rank it.`)
  } else if (unrankable.length) {
    notes.push(`${joinNames(unrankable.map(raceNameInRound))} are on ${tag}-only routes, so we can't rank them.`)
  }
  if (unannounced.length) notes.push(`${organizer} hasn't announced ${joinNames(unannounced.map(raceNameInRound))} yet.`)
  return notes
}

/**
 * The lines a series box on the events hub says about its Season on `today`:
 * the round a rider is in and when it ends - or, between rounds, the next one
 * and when it starts - with whatever in it we can't rank or the organiser
 * hasn't announced; then what comes after it, the next round and whether its
 * routes are out, or that nothing past the calendar's last day has been
 * announced yet. Nothing once the season has been run.
 *
 * Read off the calendar module alone, so a box says the same whether or not
 * the hub's fetch of the rows has come back. Rounds go by their dates, which
 * the files do not promise to be in order.
 */
export function seriesStatusLines(season: EventSeason, today: string): string[] {
  const rounds = season.rounds
    .filter(round => roundState(round, today) !== 'past')
    .map(round => ({ round, left: round.races.filter(race => !race.hidden && !hasBeenRun(race, today)) }))
    .sort((a, b) => a.round.startDate.localeCompare(b.round.startDate))
  const current = rounds.find(entry => entry.left.length) ?? rounds[0]
  if (!current) return []
  const next = rounds[rounds.indexOf(current) + 1]

  const { organizer, seriesTag: tag } = season
  const now = roundSubject(current.round)
  const ongoing = roundState(current.round, today) === 'ongoing'
  const currentLine = [
    ongoing
      ? `${now.subject} ${now.plural ? 'run' : 'runs'} until ${formatRaceDateShort(current.round.endDate)}.`
      : `${now.subject} ${now.plural ? 'start' : 'starts'} ${formatRaceDateShort(current.round.startDate)}.`,
    ...roundNotes(current.round, current.left, organizer, tag)
  ].join(' ')

  if (next) {
    const after = roundSubject(next.round)
    const notes = roundNotes(next.round, next.left, organizer, tag)
    return [currentLine, [
      `${after.subject} ${after.plural ? 'start' : 'starts'} ${formatRaceDateShort(next.round.startDate)}.`,
      ...(notes.length ? notes : ['Its races are listed above.'])
    ].join(' ')]
  }
  const lastDay = rounds.map(entry => entry.round.endDate).sort().at(-1)!
  return [currentLine, now.month !== undefined
    ? `${organizer} hasn't announced ${MONTHS[(now.month + 1) % 12]}'s theme yet.`
    : `${organizer} hasn't announced anything after ${formatRaceDateShort(lastDay)} yet.`]
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** The events hub's headline, lede and meta text. */
export interface HubCopy {
  headline: string
  lede: string
  description: string
  ogTitle: string
  ogAlt: string
}

/**
 * What the events hub says it covers, built from the Seasons on the calendar
 * so that a new series names itself: the site covers the series it has
 * curated, not every Zwift race, and its headline and meta text used to
 * claim the lot. Each series is named once, by its tag where space is short
 * and in full in the lede, in the order the seasons come in.
 */
export function hubCopy(seasons: Pick<EventSeason, 'seriesSlug' | 'seriesName' | 'seriesTag'>[]): HubCopy {
  const series = [...new Map(seasons.map(season => [season.seriesSlug, season])).values()]
  const tags = joinNames(series.map(season => season.seriesTag))
  const names = joinNames(series.map(season => season.seriesName))
  return {
    headline: `The fastest bike for ${tags} races`,
    lede: `We cover ${COUNT_WORDS[series.length] ?? series.length} series, ${names}, and work out the bike and wheels our physics model makes fastest for each of their races.`,
    description: `Race dates, routes and the fastest bike and wheel combo for each ${names} race.`,
    ogTitle: `${tags} race calendars`,
    ogAlt: `ZwiftBikes - the fastest bike and wheelset for ${tags} races`
  }
}
