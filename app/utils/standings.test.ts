import { describe, expect, it } from 'vitest'
import type { StandingsEntry, StandingsRoute, StandingsRouteTimes } from '#shared/types/standings'
import { formatMeanGap, parseGaps, profileDiffersFromRider, rankStandings, secondsPerHour, usualTimingFrames } from './standings'

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

describe('parseGaps', () => {
  it('reads a route\'s gaps back in the entries\' order, null where an entry has no time', () => {
    expect(parseGaps({ fastestSec: 600, gapTenths: '0,12,,3' })).toEqual([0, 12, null, 3])
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
