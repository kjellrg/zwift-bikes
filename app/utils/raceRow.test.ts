import { describe, expect, it } from 'vitest'
import type { EventRaceCategoryWithRoute, EventRaceRoute, EventRaceWithRoute } from '../../shared/types/events'
import { raceCourseLines, type RaceCourseLine } from './raceRow'

const innsbruck: EventRaceRoute = { slug: 'innsbruckring', name: 'Innsbruckring', world: 'innsbruck', worldName: 'Innsbruck', distance: 8.8, elevation: 77 }

function group(overrides: Partial<EventRaceCategoryWithRoute>): EventRaceCategoryWithRoute {
  return { cats: ['A', 'B'], routeSlug: 'innsbruckring', routeName: 'Innsbruckring', laps: 4, route: innsbruck, ...overrides }
}

/** A line as the row prints it. */
const printed = (line: RaceCourseLine) => [line.place, line.figures].filter(Boolean).join(' · ')

function race(categories: EventRaceCategoryWithRoute[]): EventRaceWithRoute {
  return { slug: 'round-1-week-2', round: 1, week: 2, date: '2026-09-29', format: 'points', updatedAt: '2026-09-01', categories }
}

describe('raceCourseLines', () => {
  it('gives the organiser\'s distance and elevation together, before this site\'s own totals', () => {
    const lines = raceCourseLines(race([group({
      officialDistanceKm: 35.4,
      officialElevationM: 309,
      computed: { laps: 4, distanceKm: 36.1, elevationM: 312 }
    })]))
    expect(lines).toEqual([{ key: 'A/B', label: undefined, place: 'Innsbruckring, Innsbruck', figures: '35.4 km / 309 m' }])
  })

  it('falls back to the computed totals where the organiser published none', () => {
    const lines = raceCourseLines(race([group({ computed: { laps: 4, distanceKm: 36.14, elevationM: 311.6 } })]))
    expect(printed(lines[0]!)).toBe('Innsbruckring, Innsbruck · 36.1 km / 312 m')
  })

  it('takes each figure from wherever it is known, one without the other', () => {
    const lines = raceCourseLines(race([group({ officialDistanceKm: 35.4, computed: { laps: 4, distanceKm: 36.1, elevationM: 312 } })]))
    expect(printed(lines[0]!)).toBe('Innsbruckring, Innsbruck · 35.4 km / 312 m')
    // A course off the catalog has only what the organiser published.
    const unlisted = raceCourseLines(race([group({ routeSlug: undefined, route: undefined, routeName: 'Exclusive Loop', officialDistanceKm: 30 })]))
    expect(printed(unlisted[0]!)).toBe('Exclusive Loop · 30.0 km')
  })

  it('names one course once when every group rides it', () => {
    const lines = raceCourseLines(race([
      group({ cats: ['A', 'B'], officialDistanceKm: 35.4, officialElevationM: 309 }),
      group({ cats: ['C', 'D'], officialDistanceKm: 35.4, officialElevationM: 309 })
    ]))
    expect(lines).toEqual([{ key: 'A/B, C/D', label: undefined, place: 'Innsbruckring, Innsbruck', figures: '35.4 km / 309 m' }])
  })

  it('gives groups that differ only in elevation a line each, labelled', () => {
    const lines = raceCourseLines(race([
      group({ cats: ['A', 'B'], officialDistanceKm: 35.4, officialElevationM: 309 }),
      group({ cats: ['C', 'D'], officialDistanceKm: 35.4, officialElevationM: 280 })
    ]))
    expect(lines.map(line => [line.label, printed(line)])).toEqual([
      ['A/B', 'Innsbruckring, Innsbruck · 35.4 km / 309 m'],
      ['C/D', 'Innsbruckring, Innsbruck · 35.4 km / 280 m']
    ])
  })

  it('says the route is to come for a group with no course named', () => {
    const lines = raceCourseLines(race([group({ routeSlug: undefined, routeName: undefined, route: undefined })]))
    expect(printed(lines[0]!)).toBe('Route to come')
  })
})
