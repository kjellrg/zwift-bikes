import { describe, expect, it } from 'vitest'
import type { RouteWithMeta } from '../../types/catalog'
import { getRouteBySlug } from '../catalog'
import { getRaceBySlug, getSeasonBySlug, type EventRace } from '../events'
import { rideForRoute } from '../recommendRide'
import { officialFiguresDiffer, raceRide, raceStatement, scoringRows, type RaceWithFormat } from './race'

const SITE = 'https://zwiftbikes.com'
const zrl = getSeasonBySlug('zrl-2026-27')!
const race = (slug: string) => getRaceBySlug('zrl-2026-27', slug) as RaceWithFormat
const BEFORE = '2026-09-01'
/** A/B on Makuri 40, C/D on Urumaze - a points race, scored at sprints. */
const week3 = race('round-1-week-3')
const makuri40 = getRouteBySlug('makuri-40')!
const urumaze = getRouteBySlug('urumaze')!
const hilly = getRouteBySlug('hilly-route')!
/** A course resolved as the page resolves the selected group's Ride. */
const resolved = (course: RouteWithMeta | undefined, laps: number) => course && rideForRoute(course, laps)
const statementFor = (raceData: RaceWithFormat, groupIndex = 0, course?: RouteWithMeta | null, today = BEFORE) =>
  raceStatement({
    season: zrl,
    race: raceData,
    groupIndex,
    resolvedRide: resolved(course === undefined ? getRouteBySlug(raceData.categories[groupIndex]!.routeSlug ?? '') : course ?? undefined, raceData.categories[groupIndex]!.laps),
    today,
    siteUrl: SITE
  })

describe('raceStatement', () => {
  it('names the race under its round, and every course its groups ride', () => {
    const statement = statementFor(week3)
    expect(statement.question).toBe('What bike should I ride for Zwift Racing League 2026/27 – Fresh & Fast Round 1 Week 3?')
    expect(statement.title).toBe('Fastest bike for Zwift Racing League 2026/27 – Fresh & Fast Round 1 Week 3: Makuri 40 & Urumaze (Points race) | ZwiftBikes')
    expect(statement.description).toBe('Zwift Racing League 2026/27 – Fresh & Fast Round 1 Week 3: Points race on Tuesday, 6 October 2026 – A/B on Makuri 40, C/D on Urumaze. Lap counts per category, TT bike rules, and the best legal bike and wheel combo for each course.')
    expect(statement.ogTitle).toBe('Fastest bike for Round 1 Week 3 – Makuri 40 & Urumaze')
    expect(statement.ogDescription).toBe('The fastest legal bike and wheel combo for Zwift Racing League 2026/27 – Fresh & Fast Round 1 Week 3 – A/B on Makuri 40, C/D on Urumaze.')
    // The same whichever group is selected: they describe the race.
    expect(statementFor(week3, 1).title).toBe(statement.title)
    expect(statement.coursesDiffer).toBe(true)
    // Each group's course as the organiser publishes it, for the per-group table.
    expect(statement.groups).toEqual([
      { label: 'A/B', routeName: 'Makuri 40', routeSlug: 'makuri-40', laps: 1, distance: '40.3 km', elevation: '313 m' },
      { label: 'C/D', routeName: 'Urumaze', routeSlug: 'urumaze', laps: 1, distance: '24.8 km', elevation: '193 m' }
    ])
  })

  it('names the selected group\'s course as the Ride, the heading and the report', () => {
    const statement = statementFor(week3, 1)
    expect(statement.rideName).toBe('Urumaze in Makuri Islands')
    expect(statement.heading).toEqual({
      name: 'Round 1 Week 3: Urumaze',
      crumbs: [{ label: 'Events', to: '/events' }, { label: 'Zwift Racing League 2026/27', to: '/events/zrl-2026-27' }, { label: 'Points race' }, { label: 'Tuesday, 6 October 2026' }]
    })
    expect(statement.reportSubject).toBe('C/D')
    expect(statement.reportItem).toBe('Zwift Racing League 2026/27 – Fresh & Fast Round 1 Week 3 (Urumaze)')
    expect(statement.fixedLaps).toEqual({ label: '1 lap', reason: 'Set by the C/D race group' })
    expect(statement.breadcrumbs?.map(crumb => crumb.item)).toEqual([SITE, `${SITE}/events`, `${SITE}/events/zrl-2026-27`, `${SITE}/events/zrl-2026-27/round-1-week-3`])
  })

  it('builds the Fact row from the group\'s course and laps, the lead-in once', () => {
    expect(statementFor(race('round-1-week-1')).facts).toEqual([
      { value: '27.6 km', label: 'with the 2.4 km lead-in' },
      { value: '199 m', label: 'of climbing' },
      { value: '1', label: 'lap' },
      { value: '7.6 m/km', label: 'climb ratio' },
      { value: '1', label: 'named climb, 4 sprints' }
    ])
    expect(statementFor(race('round-1-week-2'), 1).facts.slice(0, 3).map(fact => `${fact.value} ${fact.label}`)).toEqual(['26.6 km with the 0.2 km lead-in', '232 m of climbing', '3 laps'])
  })

  it('falls back to the organiser\'s figures for a group the catalog has no course for, and ranks nothing there', () => {
    const statement = statementFor(week3, 0, null)
    expect(statement.facts).toEqual([
      { value: '40.3 km', label: 'distance' },
      { value: '313 m', label: 'of climbing' },
      { value: '1', label: 'lap' }
    ])
    expect(statement.breadcrumbs).toBeUndefined()
    expect(statement.reportSubject).toBeUndefined()
    expect(statement.rideName).toBe('Makuri 40')
  })

  it('ignores a course that is not the selected group\'s', () => {
    expect(statementFor(week3, 1, makuri40).facts).toEqual(statementFor(week3, 1, null).facts)
  })

  it('states the format\'s rules and notes unmapped surfaces, as a route page does', () => {
    const rot = statementFor(race('round-1-week-1'))
    expect(rot.rules.alert).toBe('WTRL bans TT frames from a Race of Truth, so this is raced on road bikes, and they are the only thing ranked below.')
    expect(rot.rules.soloNote).toContain('WTRL turns the draft off for a Race of Truth')
    expect(rot.coverageNote).toBeUndefined()
    const unmapped = { ...makuri40, surface: { ...makuri40.surface, confidence: 'unverified' as const } }
    expect(statementFor(week3, 0, unmapped).coverageNote).toBe('Surface unverified; road assumed by model.')
  })

  it('lists the PowerUps as the organiser published them, and nothing where it published none', () => {
    expect(statementFor(race('round-1-week-4')).powerupsLine).toBe('PowerUps: none - PowerUps are disabled in TTTs.')
    expect(statementFor({ ...week3, powerups: { allowed: ['feather', 'aero'] } }).powerupsLine).toBe('PowerUps: Feather, Aero.')
    expect(statementFor({ ...week3, powerups: undefined }).powerupsLine).toBeUndefined()
  })

  it('gives the share card its text, names no setup where the groups ride different routes, and has none once run', () => {
    expect(statementFor(week3).shareCard).toEqual({
      props: { series: 'Zwift Racing League 2026/27 – Fresh & Fast', title: 'Round 1 Week 3', course: 'Makuri 40 & Urumaze · Points race', date: 'Tuesday, 6 October 2026' },
      namesSetup: false,
      alt: 'Zwift Racing League 2026/27 – Fresh & Fast Round 1 Week 3 on Makuri 40 & Urumaze: date, format and the fastest legal bike and wheel setup'
    })
    // Split by laps on one route: one setup still holds.
    expect(statementFor(race('round-1-week-2')).shareCard?.namesSetup).toBe(true)
    const run = statementFor(week3, 0, makuri40, '2026-10-07')
    expect(run.hasRun).toBe(true)
    expect(run.shareCard).toBeUndefined()
    expect(run.runNotice?.title).toBe('This race has been run')
    expect(statementFor(week3).runNotice).toBeUndefined()
  })

  it('shows scoring for a points race even with nothing listed, and none for a scratch race', () => {
    expect(statementFor(week3).scoring.shown).toBe(true)
    expect(statementFor({ ...week3, categories: [{ ...week3.categories[0]!, falSegments: [], ftsSegments: [] }] }).scoring).toMatchObject({ rows: [], shown: true })
    expect(statementFor(race('round-1-week-2')).scoring.shown).toBe(false)
  })
})

describe('raceRide', () => {
  it('rides the group\'s course and laps under the format\'s rules, and is nothing without a catalog route', () => {
    expect(raceRide(race('round-1-week-2'), 1)).toEqual({
      course: { kind: 'route', slug: 'innsbruckring' }, laps: 3, raceFormat: 'scratch', ttFramesAllowed: false, draftingAllowed: true
    })
    expect(raceRide({ ...week3, categories: [{ ...week3.categories[0]!, routeSlug: undefined }] }, 0)).toBeUndefined()
  })
})

describe('scoringRows', () => {
  // Two laps of Watopia Hilly Route: the KOM at 1.4 and 10.6 km, the sprint
  // at 6.7 and 15.9 km.
  const group = {
    cats: ['A' as const],
    routeSlug: 'hilly-route',
    laps: 2,
    falSegments: [{ name: 'Sprint Banner', slug: 'watopia-sprint', times: 2 }, { name: 'Unmapped Sprint' }],
    ftsSegments: [{ name: 'KOM', slug: 'zwift-kom' }, { name: 'Sprint Banner', slug: 'watopia-sprint', times: 2 }, { name: 'Another Unmapped' }]
  } satisfies EventRace['categories'][number]

  it('merges the FAL and FTS lists into one row a segment, counting each pass', () => {
    expect(scoringRows(group, rideForRoute(hilly, group.laps)).map(({ name, fal, fts }) => [name, fal, fts])).toEqual([
      ['KOM', 0, 1],
      ['Sprint Banner', 2, 2],
      ['Unmapped Sprint', 1, 0],
      ['Another Unmapped', 0, 1]
    ])
  })

  it('puts each row where it falls along the ride, in the order the rider meets it', () => {
    const rows = scoringRows(group, rideForRoute(hilly, group.laps))
    expect(rows[0]!.positionsKm.map(km => km.toFixed(1))).toEqual(['1.4', '10.6'])
    expect(rows[1]!.positionsKm.map(km => km.toFixed(1))).toEqual(['6.7', '15.9'])
    expect(rows[2]!.positionsKm).toEqual([])
  })

  it('keeps the published order where the course says nothing about positions', () => {
    expect(scoringRows(group, undefined).map(row => row.name)).toEqual(['Sprint Banner', 'Unmapped Sprint', 'KOM', 'Another Unmapped'])
  })
})

describe('officialFiguresDiffer', () => {
  const totals = { distanceKm: 40.25, elevationM: 312 }

  it('flags 0.15 km or 5 m of difference, either way, and no less', () => {
    expect(officialFiguresDiffer({ officialDistanceKm: 40.39, officialElevationM: 316.9 }, totals)).toBe(false)
    expect(officialFiguresDiffer({ officialDistanceKm: 40.41 }, totals)).toBe(true)
    expect(officialFiguresDiffer({ officialDistanceKm: 40.09 }, totals)).toBe(true)
    expect(officialFiguresDiffer({ officialElevationM: 317 }, totals)).toBe(true)
    expect(officialFiguresDiffer({ officialElevationM: 307 }, totals)).toBe(true)
    expect(officialFiguresDiffer({}, totals)).toBe(false)
  })

  it('has the race say both, with the organiser\'s first, where they differ', () => {
    // C/D: WTRL publishes 24.8 km for a lap of Urumaze the route data makes 26.8.
    expect(statementFor(week3, 1, urumaze).officialFiguresNote).toBe('WTRL publishes this race as 24.8 km / 193 m; the figures above are this site\'s own totals from the route\'s lead-in and lap data, which is what the physics runs on.')
    expect(statementFor(week3, 0).officialFiguresNote).toBeUndefined()
  })
})
