import { roundsLeftToRun, type EventRound } from '#shared/utils/events'
import { formatRaceDateShort } from './labels'

/** One figure in a season page's header: a number to set in bold, when there is one, and the words after it. */
export interface SeasonStat {
  value?: number
  label: string
}

/**
 * What a season page's header says about its calendar: what is left, not how
 * big the season was - "5 races left in Round 1 · 18 more in Rounds 2-4 ·
 * Calendar runs to Tue 6 Apr". The round a rider is in (or the next one, between
 * rounds) comes first, the rest of the season after it, then the last day on
 * the calendar.
 *
 * "Calendar runs to", not "Season ends": the calendar holds what the organiser
 * has announced, and ZRacing adds a month at a time, so its last day is not
 * the season's.
 *
 * Asks `roundsLeftToRun`, so it counts what the page lists, on the same day.
 * A round with no races on it yet counts no races, and is not "the round a
 * rider is in", but its dates are still the calendar's. Rounds are taken in
 * date order, which the files do not promise. Nothing left, nothing said: the
 * page has its own sentence for a season that is over.
 */
export function seasonStatsLeft(rounds: EventRound[], today: string): SeasonStat[] {
  const left = [...roundsLeftToRun(rounds, today)].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const counted = left.filter(round => round.races.length > 0)
  const [current, ...later] = counted
  if (!current) return []

  const stats: SeasonStat[] = [{ value: current.races.length, label: `${current.races.length === 1 ? 'race' : 'races'} left in Round ${current.number}` }]
  if (later.length) {
    const numbers = later.length === 1 ? `Round ${later[0]!.number}` : `Rounds ${later[0]!.number}-${later.at(-1)!.number}`
    stats.push({ value: later.reduce((total, round) => total + round.races.length, 0), label: `more in ${numbers}` })
  }
  const lastDay = left.map(round => round.endDate).sort().at(-1)!
  stats.push({ label: `Calendar runs to ${formatRaceDateShort(lastDay)}` })
  return stats
}
