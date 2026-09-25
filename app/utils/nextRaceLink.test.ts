import { describe, expect, it } from 'vitest'
import { eventSeasonSchema } from '#shared/utils/events'
import { nextRaceLink } from './nextRaceLink'

function race(slug: string, round: number, week: number, date: string, published = true) {
  return {
    slug,
    round,
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
  seriesTag: 'ZRL',
  organizer: 'WTRL',
  description: 'A season',
  rounds: [{
    number: 1,
    startDate: '2026-09-22',
    endDate: '2026-10-06',
    races: [
      race('round-1-week-1', 1, 1, '2026-09-22'),
      race('round-1-week-2', 1, 2, '2026-09-29'),
      // On the calendar with no format or course yet, so no page to link to.
      race('round-1-week-3', 1, 3, '2026-10-06', false)
    ]
  }, {
    number: 2,
    startDate: '2026-11-17',
    endDate: '2026-11-17',
    races: [race('round-2-week-1', 2, 1, '2026-11-17')]
  }]
})

const week1 = season.rounds[0]!.races[0]!
const week3 = season.rounds[0]!.races[2]!
const lastRace = season.rounds[1]!.races[0]!

describe('where a run race points a rider next', () => {
  it('names the season\'s next race by its series and its week, and links to its page', () => {
    expect(nextRaceLink(season, week1, '2026-09-23')).toEqual({
      lead: 'Next ZRL race:',
      label: 'Week 2, Tue 29 Sept',
      to: '/events/zrl-2026-27/round-1-week-2'
    })
  })

  it('links a next race with no page yet to where the season page lists it', () => {
    expect(nextRaceLink(season, week1, '2026-09-30')).toEqual({
      lead: 'Next ZRL race:',
      label: 'Week 3, Tue 6 Oct',
      to: '/events/zrl-2026-27#round-1'
    })
  })

  it('names the round too when the next race is in another round than the run one', () => {
    expect(nextRaceLink(season, week3, '2026-10-07')).toEqual({
      lead: 'Next ZRL race:',
      label: 'Round 2 Week 1, Tue 17 Nov',
      to: '/events/zrl-2026-27/round-2-week-1'
    })
  })

  it('sends a rider to the events hub once the season has nothing left to run', () => {
    expect(nextRaceLink(season, lastRace, '2026-11-18')).toEqual({
      lead: 'Every race this season has been run.',
      label: 'Races still to come',
      to: '/events'
    })
  })
})
