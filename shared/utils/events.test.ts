import { describe, expect, it } from 'vitest'
import type { EventRace } from './events'
import {
  categoryGroup,
  eventSeasonSchema,
  draftingAllowed,
  eventRaceSchema,
  formatCategoryGroup,
  getAllSeasons,
  getIndexedRaces,
  getNextUpcomingRace,
  getPublishableRaces,
  getSeasons,
  getUpcomingEventsForRoute,
  groupRoundsByAnnouncement,
  hasBeenRun,
  hasSplitCourses,
  isOnUnknownCourse,
  isRacePublishable,
  nextRaceToRun,
  lapsForCategoryGroup,
  primaryRouteSlug,
  raceCategoryGroupSchema,
  raceDisplayName,
  raceNameInRound,
  raceWhen,
  raceEndDate,
  racePowerupsSchema,
  sortRacesByDate,
  roundState,
  roundsLeftToRun,
  seasonHasBeenRun,
  sortSeasonsNewestFirst,
  ttBikesAllowed, raceContextLabel } from './events'
import { MAX_LAPS } from './routeLaps'

/**
 * The season files are hand-curated and contributed, so these tests pin the
 * two things a contributor leans on: the schema rules their PR is checked
 * against (typos in a strict object, cats-or-label, lap caps), and the
 * derivation logic that turns their entry into pages and equipment rules.
 * Catalog cross-checks (real route slugs, dates vs. round ranges, published
 * figures) stay in `scripts/events/validate-events.mjs` - they need the whole
 * curated dataset, not a unit.
 */

// A minimal valid race, round-tripped through the schema so the fixture
// itself can never drift from what a season file is allowed to contain.
function testRace(overrides: Record<string, unknown> = {}): EventRace {
  return eventRaceSchema.parse({
    slug: 'round-1-week-1',
    round: 1,
    week: 1,
    date: '2026-09-01',
    format: 'points',
    categories: [{ cats: ['A', 'B'], routeSlug: 'some-route', routeName: 'Some Route', laps: 2 }],
    updatedAt: '2026-08-01',
    ...overrides
  })
}

describe('schema rules contributors run into', () => {
  it('rejects unknown keys, so a typoed field name fails loudly instead of being ignored', () => {
    const result = raceCategoryGroupSchema.safeParse({ cats: ['A'], laps: 1, falSegment: [] })
    expect(result.success).toBe(false)
  })

  it('a category group needs lettered cats or a display label', () => {
    expect(raceCategoryGroupSchema.safeParse({ cats: [], laps: 1 }).success).toBe(false)
    expect(raceCategoryGroupSchema.safeParse({ cats: [], label: 'Range 1', laps: 1 }).success).toBe(true)
  })

  it('caps laps at MAX_LAPS - beyond it the race page could not fetch its own ranking', () => {
    expect(raceCategoryGroupSchema.safeParse({ cats: ['A'], laps: MAX_LAPS }).success).toBe(true)
    expect(raceCategoryGroupSchema.safeParse({ cats: ['A'], laps: MAX_LAPS + 1 }).success).toBe(false)
    expect(raceCategoryGroupSchema.safeParse({ cats: ['A'], laps: 0 }).success).toBe(false)
  })

  it('requires kebab-case slugs and ISO dates', () => {
    expect(() => testRace({ slug: 'Round_1' })).toThrow()
    expect(() => testRace({ date: '01-09-2026' })).toThrow()
    expect(() => testRace({ date: '2026-9-1' })).toThrow()
    // Well-formed but not a day that exists - used to survive to the page as "Invalid Date".
    expect(() => testRace({ date: '2026-02-30' })).toThrow()
  })

  it('requires a season\'s short series tag, which the events hub sets in front of its races', () => {
    const season = { slug: 'zrl-2026-27', label: '2026/27', seriesSlug: 'zrl', seriesName: 'Zwift Racing League', organizer: 'WTRL', description: 'A season', rounds: [] }
    expect(eventSeasonSchema.safeParse({ ...season, seriesTag: 'ZRL' }).success).toBe(true)
    expect(eventSeasonSchema.safeParse(season).success).toBe(false)
    expect(eventSeasonSchema.safeParse({ ...season, seriesTag: '' }).success).toBe(false)
  })

  it('rejects a powerup the enum does not know', () => {
    expect(racePowerupsSchema.safeParse({ allowed: ['feather', 'rocket'] }).success).toBe(false)
    expect(racePowerupsSchema.safeParse({ allowed: [] }).success).toBe(true)
  })
})

describe('equipment rules derived from the format', () => {
  it('TT frames are only legal in a team time trial - an unknown format means not allowed', () => {
    expect(ttBikesAllowed('ttt')).toBe(true)
    for (const format of ['points', 'scratch', 'rot', undefined] as const) {
      expect(ttBikesAllowed(format), String(format)).toBe(false)
    }
    // The rules come off the format alone, so a curated race and a format a
    // page was told through `?rules=` can never be answered differently.
    expect(ttBikesAllowed(testRace({ format: 'ttt' }).format)).toBe(true)
  })

  it('drafting is off only in a Race of Truth - which still bans TT frames', () => {
    expect(draftingAllowed('rot')).toBe(false)
    expect(ttBikesAllowed('rot')).toBe(false)
    for (const format of ['ttt', 'points', 'scratch', undefined] as const) {
      expect(draftingAllowed(format), String(format)).toBe(true)
    }
  })
})

describe('isRacePublishable', () => {
  it('needs a format, at least one group, a known route, and not to be hidden', () => {
    expect(isRacePublishable(testRace())).toBe(true)
    expect(isRacePublishable(testRace({ format: undefined }))).toBe(false)
    expect(isRacePublishable(testRace({ categories: [] }))).toBe(false)
    expect(isRacePublishable(testRace({ hidden: true }))).toBe(false)
    // A group without a catalog route can't be ranked...
    expect(isRacePublishable(testRace({ categories: [{ cats: ['A'], routeName: 'ZRL Exclusive', laps: 1 }] }))).toBe(false)
    // ...but one rankable group is enough to earn the page.
    expect(isRacePublishable(testRace({
      categories: [
        { cats: ['A', 'B'], routeName: 'ZRL Exclusive', laps: 1 },
        { cats: ['C', 'D'], routeSlug: 'some-route', routeName: 'Some Route', laps: 1 }
      ]
    }))).toBe(true)
  })
})

describe('isOnUnknownCourse', () => {
  it('is a race announced in full whose course is not in our route data', () => {
    // A ZRL exclusive: a format and a named course, but no catalog route.
    expect(isOnUnknownCourse(testRace({ categories: [{ cats: ['A'], routeName: 'ZRL Exclusive', laps: 1 }] }))).toBe(true)
  })

  it('is not a race with a page, even with one group on an unknown course', () => {
    expect(isOnUnknownCourse(testRace())).toBe(false)
    expect(isOnUnknownCourse(testRace({
      categories: [
        { cats: ['A', 'B'], routeName: 'ZRL Exclusive', laps: 1 },
        { cats: ['C', 'D'], routeSlug: 'some-route', routeName: 'Some Route', laps: 1 }
      ]
    }))).toBe(false)
  })

  it('is not a race the organiser has yet to announce, or one retired', () => {
    expect(isOnUnknownCourse(testRace({ format: undefined, categories: [{ cats: ['A'], routeName: 'ZRL Exclusive', laps: 1 }] }))).toBe(false)
    expect(isOnUnknownCourse(testRace({ categories: [] }))).toBe(false)
    // A group with no course named yet is not a course missing from our data.
    expect(isOnUnknownCourse(testRace({ categories: [{ cats: ['A'], laps: 1 }] }))).toBe(false)
    expect(isOnUnknownCourse(testRace({ hidden: true, categories: [{ cats: ['A'], routeName: 'ZRL Exclusive', laps: 1 }] }))).toBe(false)
  })
})

describe('derivations the pages are built from', () => {
  it('detects split courses by route or lap count, not just route', () => {
    const group = (routeSlug: string, laps: number) => ({ cats: ['A' as const], routeSlug, routeName: routeSlug, laps })
    expect(hasSplitCourses(testRace())).toBe(false)
    expect(hasSplitCourses(testRace({ categories: [group('x', 2), group('x', 2)] }))).toBe(false)
    expect(hasSplitCourses(testRace({ categories: [group('x', 2), group('x', 3)] }))).toBe(true)
    expect(hasSplitCourses(testRace({ categories: [group('x', 2), group('y', 2)] }))).toBe(true)
  })

  it('primaryRouteSlug skips leading groups on unlisted routes', () => {
    const race = testRace({
      categories: [
        { cats: ['A', 'B'], routeName: 'ZRL Exclusive', laps: 1 },
        { cats: ['C', 'D'], routeSlug: 'listed-route', routeName: 'Listed Route', laps: 1 }
      ]
    })
    expect(primaryRouteSlug(race)).toBe('listed-route')
  })

  it('categoryGroup falls back to the primary group, and laps default to 1', () => {
    const race = testRace()
    expect(categoryGroup(race, 5)).toBe(race.categories[0])
    expect(lapsForCategoryGroup(race)).toBe(2)
    expect(lapsForCategoryGroup(testRace({ categories: [] }))).toBe(1)
  })

  it('names groups by label when curated, otherwise WTRL-style A/B', () => {
    expect(formatCategoryGroup({ cats: ['A', 'B'] })).toBe('A/B')
    expect(formatCategoryGroup({ cats: [], label: 'Range 1' })).toBe('Range 1')
    expect(formatCategoryGroup({ cats: ['A'], label: 'Advanced' })).toBe('Advanced')
  })

  it('names a race under its round when the round is named, else under the season alone', () => {
    const season = { seriesName: 'ZRacing', label: '2026' }
    expect(raceContextLabel(season, { name: 'August: Makuri Madness' })).toBe('ZRacing 2026 - August: Makuri Madness')
    expect(raceContextLabel(season, { name: undefined })).toBe('ZRacing 2026')
    expect(raceContextLabel(season)).toBe('ZRacing 2026')
  })

  it('derives the display name from the slug convention', () => {
    expect(raceDisplayName(testRace({ slug: 'stage-3' }))).toBe('Stage 3')
    expect(raceDisplayName(testRace({ slug: 'september-stage-1' }))).toBe('Stage 1')
    expect(raceDisplayName(testRace({ slug: 'round-2-week-4', round: 2, week: 4 }))).toBe('Round 2 Week 4')
    expect(raceDisplayName(testRace({ slug: 'anything-else', round: 3, week: 1 }))).toBe('Round 3 Week 1')
  })

  it('names a race by its week under its round\'s heading, and a stage as it is', () => {
    expect(raceNameInRound(testRace({ slug: 'round-1-week-2', round: 1, week: 2 }))).toBe('Week 2')
    expect(raceNameInRound(testRace({ slug: 'round-3-week-6', round: 3, week: 6 }))).toBe('Week 6')
    expect(raceNameInRound(testRace({ slug: 'stage-3', week: 3 }))).toBe('Stage 3')
    expect(raceNameInRound(testRace({ slug: 'september-stage-1', week: 1 }))).toBe('Stage 1')
  })

  it('a race\'s last day is endDate when set, else the race day - and a race stays upcoming through its whole window', () => {
    expect(raceEndDate(testRace())).toBe('2026-09-01')
    expect(raceEndDate(testRace({ endDate: '2026-09-07' }))).toBe('2026-09-07')
  })

  it('sortRacesByDate orders by race day without mutating its input', () => {
    const later = testRace({ slug: 'round-1-week-2', date: '2026-09-08' })
    const earlier = testRace()
    const input = [later, earlier]
    const sorted = sortRacesByDate(input)
    expect(sorted.map(r => r.slug)).toEqual(['round-1-week-1', 'round-1-week-2'])
    expect(input[0]).toBe(later)
  })
})

describe('what the events hub and a season page read off a Season', () => {
  // A minimal valid season, round-tripped through the schema for the same
  // reason `testRace` is.
  function testSeason(slug: string, rounds: { number: number, startDate: string, endDate: string, races?: unknown[] }[]) {
    return eventSeasonSchema.parse({
      slug,
      label: slug,
      seriesSlug: 'zrl',
      seriesName: 'ZRL',
      seriesTag: 'ZRL',
      organizer: 'WTRL',
      description: 'A season',
      rounds: rounds.map(round => ({ ...round, races: round.races ?? [] }))
    })
  }

  it('orders seasons newest first, by the day their calendar opens', () => {
    const older = testSeason('zrl-2025-26', [{ number: 1, startDate: '2025-09-30', endDate: '2025-11-04' }])
    const newer = testSeason('zrl-2026-27', [{ number: 1, startDate: '2026-09-29', endDate: '2026-11-03' }])
    // Written newest-last in the file, which is the order the hub used to show.
    const seasons = [older, newer]
    expect(sortSeasonsNewestFirst(seasons).map(season => season.slug)).toEqual(['zrl-2026-27', 'zrl-2025-26'])
    // Ordered on the earliest round, not the file's first one.
    const outOfOrder = testSeason('zrl-2024-25', [
      { number: 2, startDate: '2025-01-06', endDate: '2025-02-10' },
      { number: 1, startDate: '2024-09-30', endDate: '2024-11-04' }
    ])
    expect(sortSeasonsNewestFirst([newer, outOfOrder, older]).map(season => season.slug))
      .toEqual(['zrl-2026-27', 'zrl-2025-26', 'zrl-2024-25'])
    expect(seasons.map(season => season.slug)).toEqual(['zrl-2025-26', 'zrl-2026-27'])
  })

  it('reads a round as to come, on now, or run, off its races', () => {
    const round = (races: EventRace[]) => ({ number: 1, startDate: '2026-09-22', endDate: '2026-10-27', races })
    const first = testRace({ slug: 'round-1-week-1', date: '2026-09-22' })
    const second = testRace({ slug: 'round-1-week-2', week: 2, date: '2026-09-29' })

    expect(roundState(round([first, second]), '2026-09-01')).toBe('upcoming')
    // One race run, one to go - the round a rider is in the middle of.
    expect(roundState(round([first, second]), '2026-09-25')).toBe('ongoing')
    expect(roundState(round([first, second]), '2026-09-30')).toBe('past')
    // A week-long stage is on from its first day and not run until its window closes.
    const stage = round([testRace({ date: '2026-09-22', endDate: '2026-09-28' })])
    expect(roundState(stage, '2026-09-25')).toBe('ongoing')
    expect(roundState(stage, '2026-09-29')).toBe('past')
    // A retired race is not on the calendar, so it neither starts a round nor holds one open.
    const retired = testRace({ slug: 'round-1-week-9', week: 9, date: '2027-01-01', hidden: true })
    expect(roundState(round([first, retired]), '2026-09-30')).toBe('past')
    // A round with no races at all is a window the organiser hasn't filled
    // in: still to come however long ago it was announced, never on and
    // never over, since there is nothing to run.
    expect(roundState(round([]), '2027-12-31')).toBe('upcoming')
  })

  it('counts a race as run only once its last day has passed', () => {
    const race = testRace({ date: '2026-09-22' })
    expect(hasBeenRun(race, '2026-09-22')).toBe(false)
    expect(hasBeenRun(race, '2026-09-23')).toBe(true)
    // A week-long stage is still to run on every day of its window.
    const stage = testRace({ date: '2026-09-22', endDate: '2026-09-28' })
    expect(hasBeenRun(stage, '2026-09-25')).toBe(false)
    expect(hasBeenRun(stage, '2026-09-28')).toBe(false)
    expect(hasBeenRun(stage, '2026-09-29')).toBe(true)
  })

  it('places a race on now, in the next seven days, or later, in UTC days', () => {
    const today = '2026-09-24'
    // A week-long stage mid-window, on its first day and on its last.
    expect(raceWhen(testRace({ date: '2026-09-21', endDate: '2026-09-27' }), today)).toBe('on-now')
    expect(raceWhen(testRace({ date: '2026-09-24', endDate: '2026-09-30' }), today)).toBe('on-now')
    expect(raceWhen(testRace({ date: '2026-09-18', endDate: '2026-09-24' }), today)).toBe('on-now')
    // A one-day race on its day.
    expect(raceWhen(testRace({ date: '2026-09-24' }), today)).toBe('on-now')
    // Starting tomorrow, and exactly seven days out, is the coming week.
    expect(raceWhen(testRace({ date: '2026-09-25' }), today)).toBe('next-7-days')
    expect(raceWhen(testRace({ date: '2026-10-01' }), today)).toBe('next-7-days')
    expect(raceWhen(testRace({ date: '2026-10-01', endDate: '2026-10-07' }), today)).toBe('next-7-days')
    // Eight days out is later, across a month and a year end as well.
    expect(raceWhen(testRace({ date: '2026-10-02' }), today)).toBe('later')
    expect(raceWhen(testRace({ date: '2027-01-01' }), '2026-12-25')).toBe('next-7-days')
    expect(raceWhen(testRace({ date: '2027-01-02' }), '2026-12-25')).toBe('later')
    // Run yesterday: nowhere.
    expect(raceWhen(testRace({ date: '2026-09-23' }), today)).toBeUndefined()
    expect(raceWhen(testRace({ date: '2026-09-17', endDate: '2026-09-23' }), today)).toBeUndefined()
  })

  it('leaves out of a calendar every race and round that has been run', () => {
    const first = testRace({ slug: 'round-1-week-1', date: '2026-09-22' })
    const second = testRace({ slug: 'round-1-week-2', week: 2, date: '2026-09-29' })
    const stage = testRace({ slug: 'round-2-week-1', round: 2, date: '2026-09-22', endDate: '2026-09-28' })
    const rounds = [
      { number: 1, startDate: '2026-09-22', endDate: '2026-09-29', races: [first, second] },
      { number: 2, startDate: '2026-09-22', endDate: '2026-09-28', races: [stage] },
      // Nothing announced yet: listed for its dates, whatever the day.
      { number: 3, startDate: '2026-11-17', endDate: '2026-12-22', races: [] }
    ]
    const listed = (today: string) => roundsLeftToRun(rounds, today)
      .map(round => `${round.number}: ${round.races.map(race => race.slug).join(' ')}`)

    // Race day itself: nothing has been run yet.
    expect(listed('2026-09-22')).toEqual(['1: round-1-week-1 round-1-week-2', '2: round-2-week-1', '3: '])
    // The day after, the one-day race has gone; the stage is mid-window and stays.
    expect(listed('2026-09-23')).toEqual(['1: round-1-week-2', '2: round-2-week-1', '3: '])
    // The stage's last day, then the day after it, which takes its round with it.
    expect(listed('2026-09-28')).toEqual(['1: round-1-week-2', '2: round-2-week-1', '3: '])
    expect(listed('2026-09-29')).toEqual(['1: round-1-week-2', '3: '])
    expect(listed('2026-09-30')).toEqual(['3: '])
    // The rounds handed in are left as they were.
    expect(rounds[0]!.races).toHaveLength(2)
  })

  it('sets apart the rounds the organiser has announced nothing of', () => {
    // WTRL's placeholders: a date on the calendar, no format and no course.
    const placeholder = (week: number) => testRace({ slug: `round-2-week-${week}`, round: 2, week, date: `2026-11-${10 + week}`, format: undefined, categories: [] })
    const rounds = [
      { number: 1, startDate: '2026-09-22', endDate: '2026-09-29', races: [testRace(), testRace({ slug: 'round-1-week-2', week: 2 })] },
      { number: 2, startDate: '2026-11-11', endDate: '2026-11-12', races: [placeholder(1), placeholder(2)] },
      // Partly announced: one race has its format and course, the other none yet.
      { number: 3, startDate: '2027-01-12', endDate: '2027-01-19', races: [testRace({ slug: 'round-3-week-1', round: 3 }), testRace({ slug: 'round-3-week-2', round: 3, week: 2, format: undefined, categories: [] })] },
      // A format alone is something announced, as is a course with no format.
      { number: 4, startDate: '2027-03-02', endDate: '2027-03-02', races: [testRace({ slug: 'round-4-week-1', round: 4, categories: [] })] },
      { number: 5, startDate: '2027-04-06', endDate: '2027-04-06', races: [testRace({ slug: 'round-5-week-1', round: 5, format: undefined })] },
      // A round with no races on it yet has nothing announced either.
      { number: 6, startDate: '2027-05-04', endDate: '2027-06-08', races: [] },
      // A retired race is on no calendar, so it announces nothing for its round.
      { number: 7, startDate: '2027-07-06', endDate: '2027-07-06', races: [placeholder(3), testRace({ slug: 'round-7-week-1', round: 7, hidden: true })] }
    ]
    const { announced, unannounced } = groupRoundsByAnnouncement(rounds)
    expect(announced.map(round => round.number)).toEqual([1, 3, 4, 5])
    expect(unannounced.map(round => round.number)).toEqual([2, 6, 7])
    // The rounds come back whole, races and all, as they were handed in.
    expect(announced[1]!.races).toHaveLength(2)
  })

  it('names the first race still to run as a season\'s next race', () => {
    const first = testRace({ slug: 'round-1-week-1', date: '2026-09-22' })
    const retired = testRace({ slug: 'round-1-week-2', week: 2, date: '2026-09-29', hidden: true })
    const third = testRace({ slug: 'round-1-week-3', week: 3, date: '2026-10-06' })
    const stage = testRace({ slug: 'round-2-week-1', round: 2, date: '2026-09-23', endDate: '2026-09-29' })
    // Rounds curated out of date order, as the organiser happened to publish them.
    const rounds = [
      { number: 2, startDate: '2026-09-23', endDate: '2026-09-29', races: [stage] },
      { number: 1, startDate: '2026-09-22', endDate: '2026-10-06', races: [first, retired, third] }
    ]
    const next = (today: string) => nextRaceToRun(rounds, today)?.slug

    // On race day the race itself is still the next one.
    expect(next('2026-09-22')).toBe('round-1-week-1')
    // A week-long stage is the next race through its last day.
    expect(next('2026-09-23')).toBe('round-2-week-1')
    expect(next('2026-09-29')).toBe('round-2-week-1')
    // A retired race is on no calendar, so it is never next.
    expect(next('2026-09-30')).toBe('round-1-week-3')
    // Nothing left to run: no next race.
    expect(next('2026-10-07')).toBeUndefined()
  })

  it('calls a season run once every race on it has been, and not before', () => {
    const season = testSeason('zracing-2026', [
      { number: 8, startDate: '2026-08-11', endDate: '2026-09-06', races: [testRace({ date: '2026-08-11', endDate: '2026-09-06' })] },
      { number: 9, startDate: '2026-09-08', endDate: '2026-10-04', races: [testRace({ slug: 'stage-2', date: '2026-09-08', endDate: '2026-10-04' })] }
    ])
    expect(seasonHasBeenRun(season, '2026-10-04')).toBe(false)
    expect(seasonHasBeenRun(season, '2026-10-05')).toBe(true)
    // A round the organiser hasn't filled in is still ahead of the rider, so
    // the season is not over while one is on it.
    const unannounced = testSeason('zrl-2026-27', [
      { number: 1, startDate: '2026-09-22', endDate: '2026-09-22', races: [testRace({ date: '2026-09-22' })] },
      { number: 2, startDate: '2026-11-17', endDate: '2026-12-22' }
    ])
    expect(seasonHasBeenRun(unannounced, '2027-01-01')).toBe(false)
    // And a season with nothing on it at all has not been run either.
    expect(seasonHasBeenRun(testSeason('zrl-2027-28', []), '2030-01-01')).toBe(false)
  })
})

describe('the curated seasons themselves', () => {
  it('season slugs and publishable race paths are unique', () => {
    const slugs = getAllSeasons().map(s => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    const paths = getPublishableRaces().map(r => r.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('getSeasons hides retired seasons; getAllSeasons keeps them for tooling', () => {
    expect(getSeasons().every(s => !s.hidden)).toBe(true)
    expect(getSeasons().length).toBeLessThanOrEqual(getAllSeasons().length)
  })

  it('indexes a race page until the race has been run, and not after', () => {
    const indexed = (today: string) => getIndexedRaces(today).map(race => race.path)
    const week1 = '/events/zrl-2026-27/round-1-week-1'
    const week2 = '/events/zrl-2026-27/round-1-week-2'
    const stage3 = '/events/zracing-2026/september-stage-3'
    // Week 1 is raced on Tue 22 Sept: indexed that day, gone the next.
    expect(indexed('2026-09-22')).toContain(week1)
    expect(indexed('2026-09-23')).not.toContain(week1)
    expect(indexed('2026-09-23')).toContain(week2)
    // A week-long stage stays indexed through its last day (Sun 27 Sept).
    expect(indexed('2026-09-27')).toContain(stage3)
    expect(indexed('2026-09-28')).not.toContain(stage3)
    // Only pages that exist: never a race with no page yet (round 2 is unannounced).
    expect(indexed('2000-01-01')).toEqual(getPublishableRaces().map(race => race.path))
    expect(indexed('2999-12-31')).toEqual([])
  })

  it('upcoming lookups honor the injected today and sort soonest first', () => {
    expect(getNextUpcomingRace('2999-12-31')).toBeUndefined()
    expect(getUpcomingEventsForRoute('no-such-route', '2000-01-01')).toEqual([])
    const upcoming = getPublishableRaces().length > 0 ? getNextUpcomingRace('2000-01-01') : undefined
    if (upcoming) {
      const all = getPublishableRaces().map(r => r.race.date).sort((a, b) => a.localeCompare(b))
      expect(upcoming.race.date).toBe(all[0])
    }
  })
})
