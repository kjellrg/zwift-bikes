import { isRacePublishable, nextRaceToRun, raceDisplayName, raceNameInRound, roundsLeftToRun, type EventRace, type EventSeason } from '#shared/utils/events'
import { formatRaceDateRange } from './labels'

/** A link in a sentence: the words before it, and the link itself. */
export interface NextRaceLink {
  lead: string
  label: string
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
 * It reads "Next ZRL race: Week 2, Tue 29 Sept": the series by its tag, and
 * the race by its week, since the notice has just named the run race's round.
 * A next race in another round is named in full ("Round 2 Week 1"), so the
 * link never reads as a week of the round that has been run.
 *
 * `today` is the caller's, as for `hasBeenRun`: the server's while the page
 * renders, the rider's once it is on their screen.
 */
export function nextRaceLink(season: EventSeason, run: Pick<EventRace, 'round'>, today: string): NextRaceLink {
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
