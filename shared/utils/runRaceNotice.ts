import { isRacePublishable, nextRaceToRun, raceDisplayName, raceFormatPhrase, raceNameInRound, raceRouteNames, roundsLeftToRun, type EventRace, type EventSeason, type RaceFormat } from './events'
import { formatRaceDateRange, formatRaceDateShort } from './raceDates'

/**
 * What a run race says above its title, on its page and in its markdown twin
 * (issue #281): one builder in the shared layer, so the two representations
 * say the same thing in the same words and cannot drift. See **Twin** in
 * `CONTEXT.md`: a twin is the page, not a summary of it.
 *
 * Nothing here may import `shared/utils/catalog`: the race page imports this
 * client-side, beside the events module (see its leaf-module rule).
 */

/** A link in a sentence: the words before it, and the link itself. */
export interface NoticeLink {
  lead: string
  label: string
  /** Site-relative, as the page's own links are; the twin prefixes its origin. */
  to: string
}

/**
 * Where a run race's page points a rider: the Season's next race (see
 * `nextRaceToRun`), or the events hub once the season has nothing left to
 * run, since the season page would then only say that it is over.
 *
 * Between the two, a season whose races have all been run can still have a
 * round with nothing on it - ZRacing's months before Zwift themes them - and
 * is not over (`seasonHasBeenRun`). The link then goes to that round's line
 * on the season page, under "Not announced yet".
 *
 * A next race with no page yet - on the calendar without a format or a
 * course - is still named, and the link goes to the season page where it is
 * listed, at its round: it is the next race whether or not it can be ranked.
 *
 * It reads "Next ZRL race: Week 2, Tue 29 Sep": the series by its tag, and
 * the race by its week, since the notice has just named the run race's round.
 * A next race in another round is named in full ("Round 2 Week 1"), so the
 * link never reads as a week of the round that has been run.
 *
 * `today` is the caller's, as for `hasBeenRun`: the server's while the page
 * renders, the rider's once it is on their screen, and the day a twin is
 * rendered on.
 */
export function nextRaceLink(season: EventSeason, run: Pick<EventRace, 'round'>, today: string): NoticeLink {
  const next = nextRaceToRun(season.rounds, today)
  if (!next) {
    // With no race left to run, what is left is rounds with none on them.
    const round = roundsLeftToRun(season.rounds, today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
    if (!round) return { lead: 'Every race this season has been run.', label: 'Races still to come', to: '/events' }
    return {
      lead: `Next ${season.seriesTag} round:`,
      label: `${round.name ?? `Round ${round.number}`}, not announced yet`,
      to: `/events/${season.slug}#round-${round.number}`
    }
  }
  const name = next.round === run.round ? raceNameInRound(next) : raceDisplayName(next)
  return {
    lead: `Next ${season.seriesTag} race:`,
    label: `${name}, ${formatRaceDateRange(next.date, next.endDate)}`,
    to: isRacePublishable(next) ? `/events/${season.slug}/${next.slug}` : `/events/${season.slug}#round-${next.round}`
  }
}

/** The notice, in its three parts under its title. */
export interface RunRaceNotice {
  title: string
  /** When it was raced, and that the ranking below still holds. */
  ranOn: string
  /** The season's next race, its next round with nothing announced, or the hub (`nextRaceLink`). */
  next: NoticeLink
  /** The primary route's own page, when a group rides a route the catalog has. */
  route?: NoticeLink
}

/**
 * The notice a run race's page shows above its title, and its twin above its
 * own. Asks nothing about whether the race has been run: that is
 * `hasBeenRun(race, today)`, asked by the caller, which shows this only then.
 *
 * Takes a race with a format, which every race with a page has
 * (`isRacePublishable`); the rules the ranking still holds under are its.
 */
export function runRaceNotice(season: EventSeason, race: EventRace & { format: RaceFormat }, today: string): RunRaceNotice {
  const ranOn = race.endDate
    ? `was raced over ${formatRaceDateRange(race.date, race.endDate)}`
    : `was raced on ${formatRaceDateShort(race.date)}`
  // The route page's ranking still holds, raced or not: the first group on a
  // route the catalog has, as the page's title and structured data use.
  const primaryGroup = race.categories.find(group => group.routeSlug)
  return {
    title: 'This race has been run',
    ranOn: `${raceDisplayName(race)} ${ranOn}. The ranking below still holds for ${raceRouteNames(race).length > 1 ? 'these routes' : 'this route'} under ${raceFormatPhrase(race.format)} rules.`,
    next: nextRaceLink(season, race, today),
    route: primaryGroup
      ? { lead: 'The route on its own:', label: `Fastest bike for ${primaryGroup.routeName ?? 'this route'}`, to: `/routes/${primaryGroup.routeSlug}` }
      : undefined
  }
}
