import { describe, expect, it } from 'vitest'
import { eventSeasonSchema } from '#shared/utils/events'
import { nextRaceLink } from './nextRaceLink'

function race(slug: string, week: number, date: string, published = true) {
  return {
    slug,
    round: 1,
    week,
    date,
    ...(published
      ? { format: 'points', categories: [{ cats: ['A', 'B'], routeSlug: 'some-route', routeName: 'Some Route', laps: 2 }] }
      : { categories: [] }),
    updatedAt: '2026-08-01'
  }
}

const season = eventSeasonSchema.parse({
  slug: 'zrl-2026-27',
  label: '2026/27',
  seriesSlug: 'zrl',
  seriesName: 'Zwift Racing League',
  organizer: 'WTRL',
  description: 'A season',
  rounds: [{
    number: 1,
    startDate: '2026-09-22',
    endDate: '2026-10-06',
    races: [
      race('round-1-week-1', 1, '2026-09-22'),
      race('round-1-week-2', 2, '2026-09-29'),
      // On the calendar with no format or course yet, so no page to link to.
      race('round-1-week-3', 3, '2026-10-06', false)
    ]
  }]
})

describe('where a run race points a rider next', () => {
  it('names the season\'s next race and links to its page', () => {
    expect(nextRaceLink(season, '2026-09-23')).toEqual({
      lead: 'Next Zwift Racing League race:',
      label: 'Round 1 Week 2, Tue 29 Sept',
      to: '/events/zrl-2026-27/round-1-week-2'
    })
  })

  it('links a next race with no page yet to where the season page lists it', () => {
    expect(nextRaceLink(season, '2026-09-30')).toEqual({
      lead: 'Next Zwift Racing League race:',
      label: 'Round 1 Week 3, Tue 6 Oct',
      to: '/events/zrl-2026-27#round-1'
    })
  })

  it('sends a rider to the events hub once the season has nothing left to run', () => {
    expect(nextRaceLink(season, '2026-10-07')).toEqual({
      lead: 'Every race this season has been run.',
      label: 'Races still to come',
      to: '/events'
    })
  })
})
