import { describe, expect, it } from 'vitest'
import { eventRaceSchema, eventSeasonSchema } from './events'
import { nextRaceLink, runRaceNotice } from './runRaceNotice'

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
      label: 'Week 2, Tue 29 Sep',
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

  it('points to a round with nothing announced yet when no race is left but the season is not over', () => {
    // ZRacing's months before Zwift themes them: dates, no races.
    const monthly = eventSeasonSchema.parse({
      ...season,
      slug: 'zracing-2026',
      seriesTag: 'ZRacing',
      rounds: [
        { number: 9, startDate: '2026-09-28', endDate: '2026-10-04', races: [{ ...race('september-stage-4', 9, 4, '2026-09-28'), endDate: '2026-10-04' }] },
        { number: 10, name: 'October', startDate: '2026-10-05', endDate: '2026-10-31', races: [] },
        { number: 11, name: 'November', startDate: '2026-11-01', endDate: '2026-11-30', races: [] }
      ]
    })
    expect(nextRaceLink(monthly, monthly.rounds[0]!.races[0]!, '2026-10-10')).toEqual({
      lead: 'Next ZRacing round:',
      label: 'October, not announced yet',
      to: '/events/zracing-2026#round-10'
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

/**
 * The whole notice a run race's page shows above its title, and its markdown
 * twin above its own: one builder, so the two say the same thing in the same
 * words (issue #281).
 */
describe('what a run race\'s page says above its title', () => {
  it('says when it was raced, where to go next and where the route is', () => {
    expect(runRaceNotice(season, week1 as typeof week1 & { format: 'points' }, '2026-09-23')).toEqual({
      title: 'This race has been run',
      ranOn: 'Round 1 Week 1 was raced on Tue 22 Sep. The ranking below still holds for this route under points race rules.',
      next: { lead: 'Next ZRL race:', label: 'Week 2, Tue 29 Sep', to: '/events/zrl-2026-27/round-1-week-2' },
      route: { lead: 'The route on its own:', label: 'Fastest bike for Some Route', to: '/routes/some-route' }
    })
  })

  it('gives a week-long stage its window, and says "these routes" when its groups ride more than one', () => {
    const stage = eventRaceSchema.parse({
      slug: 'september-stage-2',
      round: 1,
      week: 2,
      date: '2026-09-14',
      endDate: '2026-09-20',
      format: 'rot',
      categories: [
        { cats: ['A', 'B'], routeSlug: 'first-route', routeName: 'First Route', laps: 1 },
        { cats: ['C', 'D'], routeName: 'An Exclusive Route', laps: 1 }
      ],
      updatedAt: '2026-08-01'
    })
    const notice = runRaceNotice(season, stage as typeof stage & { format: 'rot' }, '2026-09-21')
    expect(notice.ranOn).toBe('Stage 2 was raced over 14–20 Sep. The ranking below still holds for these routes under Race of Truth rules.')
    // The route link is the first group the catalog has, as the page's is.
    expect(notice.route).toEqual({ lead: 'The route on its own:', label: 'Fastest bike for First Route', to: '/routes/first-route' })
  })
})
