import { describe, expect, it } from 'vitest'
import type { EventRace } from './events'
import {
  categoryGroup,
  draftingAllowed,
  eventRaceSchema,
  formatCategoryGroup,
  getAllSeasons,
  getNextUpcomingRace,
  getPublishableRaces,
  getSeasons,
  getUpcomingEventsForRoute,
  hasSplitCourses,
  isRacePublishable,
  lapsForCategoryGroup,
  primaryRouteSlug,
  raceCategoryGroupSchema,
  raceDisplayName,
  raceEndDate,
  racePowerupsSchema,
  sortRacesByDate,
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

  it('rejects a powerup the enum does not know', () => {
    expect(racePowerupsSchema.safeParse({ allowed: ['feather', 'rocket'] }).success).toBe(false)
    expect(racePowerupsSchema.safeParse({ allowed: [] }).success).toBe(true)
  })
})

describe('equipment rules derived from the format', () => {
  it('TT frames are only legal in a team time trial - an unknown format means not allowed', () => {
    expect(ttBikesAllowed(testRace({ format: 'ttt' }))).toBe(true)
    for (const format of ['points', 'scratch', 'rot', undefined]) {
      expect(ttBikesAllowed(testRace({ format })), String(format)).toBe(false)
    }
  })

  it('drafting is off only in a Race of Truth - which still bans TT frames', () => {
    const rot = testRace({ format: 'rot' })
    expect(draftingAllowed(rot)).toBe(false)
    expect(ttBikesAllowed(rot)).toBe(false)
    for (const format of ['ttt', 'points', 'scratch', undefined]) {
      expect(draftingAllowed(testRace({ format })), String(format)).toBe(true)
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
    expect(raceDisplayName(testRace({ slug: 'round-2-week-4', round: 2, week: 4 }))).toBe('Round 2 Week 4')
    expect(raceDisplayName(testRace({ slug: 'anything-else', round: 3, week: 1 }))).toBe('Round 3 Week 1')
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
