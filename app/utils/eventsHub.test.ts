import { describe, expect, it } from 'vitest'
import { eventRaceSchema, eventSeasonSchema, getSeasonBySlug, getSeasons } from '#shared/utils/events'
import { hubCopy, hubRaceGroups, relativeRaceDay, seriesStatusLines } from './eventsHub'

function race(slug: string, date: string, overrides: Record<string, unknown> = {}) {
  return eventRaceSchema.parse({
    slug,
    round: 1,
    week: 1,
    date,
    format: 'scratch',
    categories: [{ cats: ['A', 'B'], routeSlug: 'some-route', routeName: 'Some Route', laps: 1 }],
    updatedAt: '2026-08-01',
    ...overrides
  })
}

/** What a group lists, as `tag slug`. */
const listed = (groups: ReturnType<typeof hubRaceGroups>) =>
  groups.map(group => ({ title: group.title, races: group.races.map(entry => `${entry.tag} ${entry.race.slug}`) }))

describe('the events hub\'s list of races', () => {
  it('lists the curated calendars as the design did on 2026-09-24', () => {
    expect(listed(hubRaceGroups(getSeasons(), '2026-09-24'))).toEqual([
      { title: 'On now', races: ['ZRacing september-stage-3'] },
      { title: 'Next 7 days', races: ['ZRacing september-stage-4', 'ZRL round-1-week-2'] },
      // Week 6 is on a course we can't rank, so it has no page and is not listed.
      { title: 'Later', races: ['ZRL round-1-week-3', 'ZRL round-1-week-4', 'ZRL round-1-week-5'] }
    ])
  })

  it('mixes the seasons into one list by date, each race tagged and linked by its season', () => {
    const seasons = [
      { slug: 'zrl-2026-27', seriesTag: 'ZRL', rounds: [{ races: [race('round-1-week-3', '2026-10-06'), race('round-1-week-2', '2026-09-29')] }] },
      { slug: 'zracing-2026', seriesTag: 'ZRacing', rounds: [{ races: [race('stage-4', '2026-09-28', { endDate: '2026-10-04' })] }, { races: [race('stage-5', '2026-10-05', { endDate: '2026-10-11' })] }] }
    ]
    const groups = hubRaceGroups(seasons, '2026-09-24')
    expect(listed(groups)).toEqual([
      { title: 'Next 7 days', races: ['ZRacing stage-4', 'ZRL round-1-week-2'] },
      { title: 'Later', races: ['ZRacing stage-5', 'ZRL round-1-week-3'] }
    ])
    expect(groups[0]!.races[1]!.seasonSlug).toBe('zrl-2026-27')
    expect(groups[0]!.when).toBe('next-7-days')
  })

  it('lists only races with a page, leaves out what has been run, and shows no empty group', () => {
    const seasons = [{
      slug: 'zrl-2026-27',
      seriesTag: 'ZRL',
      rounds: [{
        races: [
          race('round-1-week-1', '2026-09-22'),
          race('round-1-week-2', '2026-09-29'),
          // Announced on a course outside the catalog, announced not at all, and retired.
          race('round-1-week-3', '2026-10-06', { categories: [{ cats: ['A', 'B'], routeName: 'ZRL Exclusive Route', laps: 1 }] }),
          race('round-1-week-4', '2026-10-13', { format: undefined, categories: [] }),
          race('round-1-week-5', '2026-10-20', { hidden: true })
        ]
      }]
    }]
    expect(listed(hubRaceGroups(seasons, '2026-09-24'))).toEqual([
      { title: 'Next 7 days', races: ['ZRL round-1-week-2'] }
    ])
    expect(hubRaceGroups(seasons, '2026-10-01')).toEqual([])
  })
})

describe('the relative line under a race\'s date', () => {
  const today = '2026-09-24'

  it('says a one-day race is on today, tomorrow or in so many days', () => {
    expect(relativeRaceDay(race('a', '2026-09-24'), today)).toBe('today')
    expect(relativeRaceDay(race('a', '2026-09-25'), today)).toBe('tomorrow')
    expect(relativeRaceDay(race('a', '2026-09-29'), today)).toBe('in 5 days')
    expect(relativeRaceDay(race('a', '2026-10-06'), today)).toBe('in 12 days')
  })

  it('says when a stage on now ends, by its weekday within the week', () => {
    expect(relativeRaceDay(race('a', '2026-09-21', { endDate: '2026-09-27' }), today)).toBe('ends Sun')
    expect(relativeRaceDay(race('a', '2026-09-18', { endDate: '2026-09-24' }), today)).toBe('ends today')
    expect(relativeRaceDay(race('a', '2026-09-19', { endDate: '2026-09-25' }), today)).toBe('ends tomorrow')
    // A window longer than a week would make a weekday ambiguous.
    expect(relativeRaceDay(race('a', '2026-09-20', { endDate: '2026-10-04' }), today)).toBe('ends in 10 days')
  })

  it('says when a stage still to come starts, by its weekday within the week', () => {
    expect(relativeRaceDay(race('a', '2026-09-28', { endDate: '2026-10-04' }), today)).toBe('starts Mon')
    expect(relativeRaceDay(race('a', '2026-09-25', { endDate: '2026-10-01' }), today)).toBe('starts tomorrow')
    expect(relativeRaceDay(race('a', '2026-10-01', { endDate: '2026-10-07' }), today)).toBe('starts in 7 days')
  })

  it('says nothing of a race that has been run', () => {
    expect(relativeRaceDay(race('a', '2026-09-23'), today)).toBeUndefined()
  })
})

describe('what a series box on the hub says', () => {
  /** A ZRL week: raced on a catalog route, on WTRL's own route, or not announced at all. */
  const week = (round: number, week: number, date: string, kind: 'ranked' | 'exclusive' | 'unannounced' = 'ranked') => ({
    slug: `round-${round}-week-${week}`,
    round,
    week,
    date,
    ...(kind === 'unannounced' ? { categories: [] } : { format: 'points' }),
    ...(kind === 'ranked' ? { categories: [{ cats: ['A', 'B'], routeSlug: 'some-route', routeName: 'Some Route', laps: 1 }] } : {}),
    ...(kind === 'exclusive' ? { categories: [{ cats: ['A', 'B'], routeName: 'ZRL Exclusive Route', laps: 1 }] } : {}),
    updatedAt: '2026-08-01'
  })
  const zrl = (rounds: { number: number, name?: string, startDate: string, endDate: string, races: unknown[] }[]) => eventSeasonSchema.parse({
    slug: 'zrl-2026-27', label: '2026/27', seriesSlug: 'zrl', seriesName: 'Zwift Racing League', seriesTag: 'ZRL', organizer: 'WTRL', description: 'A season', rounds
  })
  const round1 = (races: unknown[]) => ({ number: 1, name: 'Fresh & Fast', startDate: '2026-09-22', endDate: '2026-10-13', races })
  const round2 = (races: unknown[] = [week(2, 1, '2026-11-17', 'unannounced'), week(2, 2, '2026-11-24', 'unannounced')]) =>
    ({ number: 2, name: 'Team Tempo', startDate: '2026-11-17', endDate: '2026-11-24', races })

  it('reads the curated calendars as the design did on 2026-09-24', () => {
    expect(seriesStatusLines(getSeasonBySlug('zrl-2026-27')!, '2026-09-24')).toEqual([
      'Round 1, Fresh & Fast, runs until Tue 27 Oct. Its last race is on a course that isn\'t in our route data, so we can\'t rank it.',
      'Round 2, Team Tempo, starts Tue 17 Nov. WTRL hasn\'t announced its routes yet.'
    ])
    expect(seriesStatusLines(getSeasonBySlug('zracing-2026')!, '2026-09-24')).toEqual([
      'September\'s stages, Zwift Racing Powered by DURA-ACE, run until Sun 4 Oct.',
      'Zwift hasn\'t announced October\'s theme yet.'
    ])
  })

  it('names which races of a round we can\'t rank, and which are not announced yet', () => {
    const season = zrl([round1([week(1, 1, '2026-09-22'), week(1, 2, '2026-09-29', 'exclusive'), week(1, 3, '2026-10-06', 'unannounced'), week(1, 4, '2026-10-13')]), round2()])
    expect(seriesStatusLines(season, '2026-09-24')[0]).toBe('Round 1, Fresh & Fast, runs until Tue 13 Oct. Week 2 is on a course that isn\'t in our route data, so we can\'t rank it. WTRL hasn\'t announced Week 3 yet.')
    const two = zrl([round1([week(1, 1, '2026-09-22'), week(1, 2, '2026-09-29', 'exclusive'), week(1, 3, '2026-10-06', 'exclusive'), week(1, 4, '2026-10-13')]), round2()])
    expect(seriesStatusLines(two, '2026-09-24')[0]).toBe('Round 1, Fresh & Fast, runs until Tue 13 Oct. Week 2 and Week 3 are on courses that aren\'t in our route data, so we can\'t rank them.')
    // Once it has been run, a race is no longer the round's to explain.
    expect(seriesStatusLines(season, '2026-10-07')[0]).toBe('Round 1, Fresh & Fast, runs until Tue 13 Oct.')
  })

  it('says a round starts, rather than runs, before its first race', () => {
    const season = zrl([round1([week(1, 1, '2026-09-22'), week(1, 2, '2026-09-29')]), round2()])
    expect(seriesStatusLines(season, '2026-09-01')[0]).toBe('Round 1, Fresh & Fast, starts Tue 22 Sept.')
    // Between rounds the next one is the round a rider is waiting on, and nothing comes after it yet.
    expect(seriesStatusLines(season, '2026-10-01')).toEqual([
      'Round 2, Team Tempo, starts Tue 17 Nov. WTRL hasn\'t announced its routes yet.',
      'WTRL hasn\'t announced anything after Tue 24 Nov yet.'
    ])
  })

  it('says a next round\'s races are listed once they can be ranked, and names a round without a name by its number', () => {
    const season = zrl([
      round1([week(1, 1, '2026-09-22')]),
      { ...round2([week(2, 1, '2026-11-17'), week(2, 2, '2026-11-24')]), name: undefined }
    ])
    expect(seriesStatusLines(season, '2026-09-22')[1]).toBe('Round 2 starts Tue 17 Nov. Its races are listed above.')
  })

  it('counts a round the organiser has put dates on and nothing else as still to come', () => {
    const season = zrl([round1([week(1, 1, '2026-09-22')]), { ...round2([]), name: 'Team Tempo' }])
    expect(seriesStatusLines(season, '2026-09-22')[1]).toBe('Round 2, Team Tempo, starts Tue 17 Nov. WTRL hasn\'t announced its routes yet.')
  })

  it('names the month after a monthly series\' last one, across a year end', () => {
    const season = eventSeasonSchema.parse({
      ...getSeasonBySlug('zracing-2026')!,
      rounds: [{ number: 12, name: 'December: Winter Wonderland', startDate: '2026-12-07', endDate: '2026-12-13', races: [{ slug: 'december-stage-1', round: 12, week: 1, date: '2026-12-07', endDate: '2026-12-13', categories: [], updatedAt: '2026-08-01' }] }]
    })
    expect(seriesStatusLines(season, '2026-12-01')).toEqual([
      'December\'s stages, Winter Wonderland, start Mon 7 Dec. Zwift hasn\'t announced its routes yet.',
      'Zwift hasn\'t announced January\'s theme yet.'
    ])
  })

  it('says nothing once the season has been run', () => {
    expect(seriesStatusLines(zrl([round1([week(1, 1, '2026-09-22')])]), '2026-09-23')).toEqual([])
  })
})

describe('what the hub says it covers', () => {
  it('names the series on the calendar, never every Zwift race', () => {
    expect(hubCopy(getSeasons())).toEqual({
      headline: 'The fastest bike for ZRL and ZRacing races',
      lede: 'We cover two series, Zwift Racing League and ZRacing, and work out the bike and wheels our physics model makes fastest for each of their races.',
      description: 'Race dates, routes and the fastest bike and wheel combo for each Zwift Racing League and ZRacing race.',
      ogTitle: 'ZRL and ZRacing race calendars',
      ogAlt: 'ZwiftBikes - the fastest bike and wheelset for ZRL and ZRacing races'
    })
  })

  it('names a series once however many of its seasons are on, and a new one as soon as it is', () => {
    const season = (slug: string, seriesSlug: string, seriesName: string, seriesTag: string) => ({ slug, seriesSlug, seriesName, seriesTag })
    const copy = hubCopy([
      season('zrl-2026-27', 'zrl', 'Zwift Racing League', 'ZRL'),
      season('zrl-2027-28', 'zrl', 'Zwift Racing League', 'ZRL'),
      season('zracing-2026', 'zracing', 'ZRacing', 'ZRacing'),
      season('tour-2027', 'tour', 'Tour de Zwift', 'TdZ')
    ])
    expect(copy.headline).toBe('The fastest bike for ZRL, ZRacing and TdZ races')
    expect(copy.lede).toMatch(/^We cover three series, Zwift Racing League, ZRacing and Tour de Zwift, and/)
    expect(hubCopy([season('zrl-2026-27', 'zrl', 'Zwift Racing League', 'ZRL')]).lede).toMatch(/^We cover one series, Zwift Racing League, and/)
  })
})
