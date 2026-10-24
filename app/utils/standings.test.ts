import { describe, expect, it } from 'vitest'
import type { StandingsEntry, StandingsRoute, StandingsRouteTimes } from '#shared/types/standings'
import { bikeRecord, formatGapSeconds, formatMargin, formatMeanGap, parseGaps, profileDiffersFromRider, rankStandings, secondsPerHour, usualTimingFrames, winsRecord } from './standings'

const entries: StandingsEntry[] = [
  { id: '1', name: 'Aero' },
  { id: '2', name: 'Climber' },
  { id: '3', name: 'Allround' }
]

/** A route's times in a test's terms: its gaps as numbers, null for no time. */
interface TestTimes {
  fastestSec: number
  gapTenths: (number | null)[]
}

const asPayload = ({ fastestSec, gapTenths }: TestTimes): StandingsRouteTimes => ({ fastestSec, gapTenths: gapTenths.map(gap => gap ?? '').join(',') })

function route(slug: string, standard?: TestTimes, tt?: TestTimes): StandingsRoute {
  return {
    slug,
    name: slug,
    world: 'watopia',
    worldName: 'Watopia',
    distance: 10,
    elevation: 100,
    terrain: 'rolling',
    gravel: false,
    cobble: false,
    times: { ...(standard ? { standard: asPayload(standard) } : {}), ...(tt ? { tt: asPayload(tt) } : {}) }
  }
}

describe('rankStandings', () => {
  it('ranks by the mean gap as a share of each route\'s fastest time, so every route counts once', () => {
    // A 10-minute route and a 100-minute one. Climber loses 12 s on the short
    // route, Aero 60 s on the long one: fewer seconds for Climber, but 2% of
    // a route against Aero's 1%, so Aero averages the smaller share. Allround
    // loses 0.4% on each, the smallest mean of the three.
    const routes = [
      route('short', { fastestSec: 600, gapTenths: [0, 120, 24] }),
      route('long', { fastestSec: 6000, gapTenths: [600, 0, 240] })
    ]
    const { rows, routeCount } = rankStandings(routes, entries, 'standard')
    expect(routeCount).toBe(2)
    expect(rows.map(row => [row.rank, row.entry.name])).toEqual([[1, 'Allround'], [2, 'Aero'], [3, 'Climber']])
    expect(rows.find(row => row.entry.name === 'Aero')!.meanGapPct).toBeCloseTo(0.5)
    expect(rows.find(row => row.entry.name === 'Climber')!.meanGapPct).toBeCloseTo(1)
  })

  it('counts the routes each entry is fastest on', () => {
    const routes = [
      route('a', { fastestSec: 1000, gapTenths: [0, 50, 10] }),
      route('b', { fastestSec: 1000, gapTenths: [0, 40, 10] }),
      route('c', { fastestSec: 1000, gapTenths: [20, 0, 10] })
    ]
    const wins = Object.fromEntries(rankStandings(routes, entries, 'standard').rows.map(row => [row.entry.name, row.wins]))
    expect(wins).toEqual({ Aero: 2, Climber: 1, Allround: 0 })
  })

  it('keeps the routes each entry is fastest on, by name, for the Fastest on Overlay', () => {
    const routes = [
      route('b-route', { fastestSec: 1000, gapTenths: [0, 40, 10] }),
      route('a-route', { fastestSec: 1000, gapTenths: [0, 50, 10] }),
      route('c-route', { fastestSec: 1000, gapTenths: [20, 0, 10] })
    ]
    const { rows } = rankStandings(routes, entries, 'standard')
    const aero = rows.find(row => row.entry.name === 'Aero')!
    expect(aero.wonOn.map(won => won.slug)).toEqual(['b-route', 'a-route'])
    expect(winsRecord(aero, 'standard')).toEqual({
      name: 'Aero',
      linkQuery: '',
      routes: [
        { slug: 'a-route', name: 'a-route', worldName: 'Watopia', terrainLabel: 'Rolling' },
        { slug: 'b-route', name: 'b-route', worldName: 'Watopia', terrainLabel: 'Rolling' }
      ]
    })
    expect(winsRecord(aero, 'tt').linkQuery).toBe('?category=tt')
    expect(rows.find(row => row.entry.name === 'Allround')!.wonOn).toEqual([])
  })

  it('breaks a tie in the mean on wins, then by name', () => {
    const routes = [
      route('a', { fastestSec: 1000, gapTenths: [0, 20, 10] }),
      route('b', { fastestSec: 1000, gapTenths: [20, 0, 10] })
    ]
    expect(rankStandings(routes, entries, 'standard').rows.map(row => row.entry.name)).toEqual(['Aero', 'Climber', 'Allround'])
  })

  it('counts only the routes with times for the category asked for', () => {
    const routes = [
      route('road-only', { fastestSec: 1000, gapTenths: [0, 10, 20] }),
      route('both', { fastestSec: 1000, gapTenths: [30, 0, 10] }, { fastestSec: 900, gapTenths: [0, 9, 18] })
    ]
    expect(rankStandings(routes, entries, 'standard').routeCount).toBe(2)
    const tt = rankStandings(routes, entries, 'tt')
    expect(tt.routeCount).toBe(1)
    expect(tt.rows[0]!.entry.name).toBe('Aero')
    expect(tt.rows[1]!.meanGapPct).toBeCloseTo(0.1)
  })

  it('leaves out an entry missing a time on any counted route, rather than averaging it over fewer', () => {
    const routes = [
      route('a', { fastestSec: 1000, gapTenths: [0, 10, null] }),
      route('b', { fastestSec: 1000, gapTenths: [0, 10, 5] })
    ]
    const { rows, untimed } = rankStandings(routes, entries, 'standard')
    expect(rows.map(row => row.entry.name)).toEqual(['Aero', 'Climber'])
    expect(untimed.map(entry => entry.name)).toEqual(['Allround'])
  })

  it('ranks nothing over no routes', () => {
    expect(rankStandings([], entries, 'standard')).toEqual({ rows: [], routeCount: 0, untimed: [] })
  })
})

describe('bikeRecord', () => {
  const terrainRoute = (slug: string, terrain: StandingsRoute['terrain'], gapTenths: (number | null)[]): StandingsRoute =>
    ({ ...route(slug, { fastestSec: 1000, gapTenths }), terrain })
  const routes = [
    terrainRoute('flat-1', 'flat', [0, 50, 10]),
    terrainRoute('flat-2', 'flat', [20, 0, 10]),
    terrainRoute('hilly-1', 'hilly', [100, 0, 10]),
    terrainRoute('hilly-2', 'hilly', [0, 30, 10])
  ]

  it('breaks the mean gap down by terrain and names the closest and furthest routes', () => {
    const standings = rankStandings(routes, entries, 'standard')
    const aero = standings.rows.find(row => row.entry.name === 'Aero')!
    const record = bikeRecord(aero, standings.rows, routes, entries, 'standard')
    expect(record).toMatchObject({ frameId: 1, name: 'Aero', rank: 3, ranked: 3, wins: 2, routeCount: 4, linkQuery: '' })
    expect(record.meanGapSec).toBeCloseTo(3)
    // Flat: 0% and 0.2%; hilly: 1% and 0% - each as a share of a 1000 s route.
    expect(record.terrain.map(row => [row.label, row.routeCount])).toEqual([['Flat', 2], ['Hilly', 2]])
    expect(record.terrain[0]!.meanGapPct).toBeCloseTo(0.1)
    expect(record.terrain[1]!.meanGapPct).toBeCloseTo(0.5)
    expect(record.terrain.map(row => row.meanGapSec)).toEqual([1, 5])
    expect(record.closest.map(gap => gap.slug)).toEqual(['flat-1', 'hilly-2', 'flat-2'])
    expect(record.closest.map(gap => gap.gapSec)).toEqual([0, 0, 2])
    expect(record.furthest.map(gap => gap.slug)).toEqual(['hilly-1'])
  })

  it('measures the fastest bike against the runner-up instead of against itself', () => {
    // Allround is fastest (0.1%) and Climber the runner-up (0.2%): on flat-1 Allround
    // loses 1 s and Climber 5 s, on flat-2 Allround 1 s and Climber 0 s, and so on.
    const standings = rankStandings(routes, entries, 'standard')
    const leader = standings.rows[0]!
    const record = bikeRecord(leader, standings.rows, routes, entries, 'standard')
    expect(leader.entry.name).toBe('Allround')
    expect(record.marginAgainst).toBe('Climber')
    // Margins to Climber: flat-1 -0.4%, flat-2 +0.1%, hilly-1 +0.1%, hilly-2 -0.2% (negative: ahead).
    expect(record.closest.map(gap => [gap.slug, gap.gapPct.toFixed(1)])).toEqual([['flat-2', '0.1'], ['hilly-1', '0.1'], ['hilly-2', '-0.2']])
    expect(record.furthest.map(gap => gap.slug)).toEqual(['flat-1'])
    expect(record.furthest[0]!.gapSec).toBeCloseTo(-4)
    // Everyone else is measured against the fastest, as before.
    expect(bikeRecord(standings.rows[1]!, standings.rows, routes, entries, 'standard').marginAgainst).toBeUndefined()
  })

  it('names the bikes ranked either side of it, and how far apart their means are', () => {
    const standings = rankStandings(routes, entries, 'standard')
    const at = (name: string) => bikeRecord(standings.rows.find(row => row.entry.name === name)!, standings.rows, routes, entries, 'standard')
    // Climber (0.2%, 2 s) sits between Allround (0.1%, 1 s) and Aero (0.3%, 3 s).
    expect(at('Climber').ahead).toMatchObject({ name: 'Allround' })
    expect(at('Climber').ahead!.gapPct).toBeCloseTo(0.1)
    expect(at('Climber').ahead!.gapSec).toBeCloseTo(-1)
    expect(at('Climber').behind).toMatchObject({ name: 'Aero' })
    expect(at('Climber').behind!.gapSec).toBeCloseTo(1)
    expect(at('Allround').ahead).toBeUndefined()
    expect(at('Aero').behind).toBeUndefined()
  })

  it('keeps the sign of the seconds, which can disagree with the ranking by share', () => {
    // Over a 6000 s and a 600 s route, Aero loses 60 s on the long one (0.5% on average,
    // 30 s) and Climber 12 s on the short one (1% on average, 6 s): Aero ranks first
    // by share, yet Climber is 24 s faster on average in seconds.
    const mixed = [
      route('long', { fastestSec: 6000, gapTenths: [600, 0] }),
      route('short', { fastestSec: 600, gapTenths: [0, 120] })
    ]
    const pair = entries.slice(0, 2)
    const standings = rankStandings(mixed, pair, 'standard')
    expect(standings.rows.map(row => row.entry.name)).toEqual(['Aero', 'Climber'])
    const aero = bikeRecord(standings.rows[0]!, standings.rows, mixed, pair, 'standard')
    expect(aero.behind!.gapPct).toBeCloseTo(0.5)
    expect(aero.behind!.gapSec).toBeCloseTo(-24)
  })

  it('leaves out routes the bike has no time on, and links Time trial routes in their category', () => {
    const partial = [...routes, terrainRoute('untimed', 'rolling', [null, 0, 0])]
    const standings = rankStandings(partial, entries, 'standard')
    const row = { entry: entries[0]!, rank: 1, meanGapPct: 0, wins: 0, wonOn: [] }
    const record = bikeRecord(row, [row], partial, entries, 'standard')
    expect(record.routeCount).toBe(4)
    expect(record.terrain.map(terrain => terrain.label)).not.toContain('Rolling')
    expect(standings.untimed.map(entry => entry.name)).toEqual(['Aero'])
    expect(bikeRecord(row, [row], [], entries, 'tt').linkQuery).toBe('?category=tt')
  })
})

describe('parseGaps', () => {
  it('reads a route\'s gaps back in the entries\' order, null where an entry has no time', () => {
    expect(parseGaps({ fastestSec: 600, gapTenths: '0,12,,3' })).toEqual([0, 12, null, 3])
  })
})

describe('formatGapSeconds', () => {
  it('prints one decimal, and "<0.1 s" for a gap that is real but rounds to nothing', () => {
    expect(formatGapSeconds(2.14)).toBe('2.1 s')
    expect(formatGapSeconds(0)).toBe('0.0 s')
    expect(formatGapSeconds(0.02)).toBe('<0.1 s')
  })
})

describe('formatMargin', () => {
  it('says which side of the runner-up a share is, and level when it rounds to nothing', () => {
    expect(formatMargin(-0.024)).toBe('0.02% ahead')
    expect(formatMargin(0.031)).toBe('0.03% behind')
    expect(formatMargin(0.004)).toBe('level')
  })
})

describe('formatMeanGap', () => {
  it('prints two decimals with a plus, and a clean zero for an entry fastest everywhere', () => {
    expect(formatMeanGap(0.4234)).toBe('+0.42%')
    expect(formatMeanGap(0)).toBe('0.00%')
    expect(formatMeanGap(0.004)).toBe('0.00%')
    expect(formatMeanGap(3.2)).toBe('+3.20%')
  })
})

describe('secondsPerHour', () => {
  it('turns a share into seconds lost per hour of riding', () => {
    expect(secondsPerHour(1)).toBe(36)
    expect(secondsPerHour(0.42)).toBe(15)
  })
})

describe('usualTimingFrames', () => {
  it('names the most common timing frames first, at most two, ties alphabetical', () => {
    const on = (slug: string, timedOn: string): StandingsRoute => {
      const base = route(slug, { fastestSec: 600, gapTenths: [0] })
      return { ...base, times: { standard: { ...base.times.standard!, timedOn } } }
    }
    const routes = [on('a', 'Tarmac'), on('b', 'Aethos'), on('c', 'Tarmac'), on('d', 'Venge')]
    expect(usualTimingFrames(routes, 'standard')).toEqual(['Tarmac', 'Aethos'])
    expect(usualTimingFrames(routes, 'tt')).toEqual([])
  })
})

describe('profileDiffersFromRider', () => {
  const rider = { weightKg: 75, heightCm: 183, powerW: 225, upgradeStage: 5, draftMode: 'solo' }
  it('compares weight, height and power', () => {
    expect(profileDiffersFromRider({ weightKg: 75, heightCm: 183, powerW: 225 }, rider)).toBe(false)
    expect(profileDiffersFromRider({ weightKg: 75, heightCm: 183, powerW: 230 }, rider)).toBe(true)
  })
})
