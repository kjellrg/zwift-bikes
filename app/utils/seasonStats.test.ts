import { describe, expect, it } from 'vitest'
import { eventRaceSchema, getSeasonBySlug } from '#shared/utils/events'
import { seasonStatsLeft } from './seasonStats'

function race(round: number, week: number, date: string, overrides: Record<string, unknown> = {}) {
  return eventRaceSchema.parse({ slug: `round-${round}-week-${week}`, round, week, date, categories: [], updatedAt: '2026-08-01', ...overrides })
}

/** Two races in each of three rounds, a week apart. */
const rounds = [
  { number: 1, startDate: '2026-09-22', endDate: '2026-09-29', races: [race(1, 1, '2026-09-22'), race(1, 2, '2026-09-29')] },
  { number: 2, startDate: '2026-11-17', endDate: '2026-11-24', races: [race(2, 1, '2026-11-17'), race(2, 2, '2026-11-24')] },
  { number: 3, startDate: '2027-01-12', endDate: '2027-01-19', races: [race(3, 1, '2027-01-12'), race(3, 2, '2027-01-19')] }
]

describe('what a season page\'s header says is left', () => {
  it('counts the races left in the round a rider is in, then the rest, then when the calendar runs to', () => {
    expect(seasonStatsLeft(rounds, '2026-09-23')).toEqual([
      { value: 1, label: 'race left in Round 1' },
      { value: 4, label: 'more in Rounds 2-3' },
      { label: 'Calendar runs to Tue 19 Jan' }
    ])
    // Before the season opens nothing has been run, so everything is left.
    expect(seasonStatsLeft(rounds, '2026-09-01')[0]).toEqual({ value: 2, label: 'races left in Round 1' })
  })

  it('moves on to the next round once one has been run, and names a single round after it', () => {
    expect(seasonStatsLeft(rounds, '2026-10-01')).toEqual([
      { value: 2, label: 'races left in Round 2' },
      { value: 2, label: 'more in Round 3' },
      { label: 'Calendar runs to Tue 19 Jan' }
    ])
    expect(seasonStatsLeft(rounds, '2027-01-13')).toEqual([
      { value: 1, label: 'race left in Round 3' },
      { label: 'Calendar runs to Tue 19 Jan' }
    ])
  })

  it('leaves out a retired race, and counts only rounds with races on them', () => {
    const withRetired = [
      { ...rounds[0]!, races: [...rounds[0]!.races, race(1, 3, '2026-09-29', { slug: 'round-1-week-3', hidden: true })] },
      // Dates and nothing else yet: it has no races to count, but its dates are still the calendar's.
      { number: 4, startDate: '2027-03-02', endDate: '2027-04-06', races: [] }
    ]
    expect(seasonStatsLeft(withRetired, '2026-09-23')).toEqual([
      { value: 1, label: 'race left in Round 1' },
      { label: 'Calendar runs to Tue 6 Apr' }
    ])
  })

  it('goes by the calendar\'s dates, not the order its rounds are written in', () => {
    expect(seasonStatsLeft([rounds[1]!, rounds[0]!], '2026-09-23')[0]).toEqual({ value: 1, label: 'race left in Round 1' })
  })

  it('says nothing once everything has been run, or before anything is on the calendar', () => {
    expect(seasonStatsLeft(rounds, '2027-02-01')).toEqual([])
    expect(seasonStatsLeft([], '2026-09-23')).toEqual([])
  })

  it('reads the ZRL 2026/27 calendar as the design did, a week into round 1', () => {
    expect(seasonStatsLeft(getSeasonBySlug('zrl-2026-27')!.rounds, '2026-09-24')).toEqual([
      { value: 5, label: 'races left in Round 1' },
      { value: 18, label: 'more in Rounds 2-4' },
      { label: 'Calendar runs to Tue 6 Apr' }
    ])
  })
})
