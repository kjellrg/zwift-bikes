import { isRacePublishable, nextRaceToRun, raceDisplayName, type EventSeason } from '#shared/utils/events'
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
 * A next race with no page yet - on the calendar without a format or a
 * course - is still named, and the link goes to the season page where it is
 * listed, at its round: it is the next race whether or not it can be ranked.
 *
 * `today` is the caller's, as for `hasBeenRun`: the server's while the page
 * renders, the rider's once it is on their screen.
 */
export function nextRaceLink(season: EventSeason, today: string): NextRaceLink {
  const next = nextRaceToRun(season.rounds, today)
  if (!next) return { lead: 'Every race this season has been run.', label: 'Races still to come', to: '/events' }
  return {
    lead: `Next ${season.seriesName} race:`,
    label: `${raceDisplayName(next)}, ${formatRaceDateRange(next.date, next.endDate)}`,
    to: isRacePublishable(next) ? `/events/${season.slug}/${next.slug}` : `/events/${season.slug}#round-${next.round}`
  }
}
