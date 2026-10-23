import type { StandingsCategory, StandingsEntry, StandingsRider, StandingsRoute, StandingsRouteTimes } from '#shared/types/standings'

/** How many rows a Standings page shows before its "Show all" button. */
export const STANDINGS_PAGE_SIZE = 25

/** One bike's or wheelset's place in the Standings over the routes a rider filtered to. */
export interface StandingsRow {
  entry: StandingsEntry
  /** 1 is the smallest mean gap. */
  rank: number
  /**
   * The mean of its gap on each route as a share of that route's fastest
   * time, in percent. Each route counts once however long it is, so one
   * 100 km route does not outweigh ten 10 km ones.
   */
  meanGapPct: number
  /** How many of the routes it is the fastest on. */
  wins: number
}

export interface Standings {
  rows: StandingsRow[]
  /** How many routes the rows average over: those of the filtered routes with times for the category. */
  routeCount: number
  /** Entries left out because some of those routes have no time for them - a mean over fewer routes is not comparable. */
  untimed: StandingsEntry[]
}

/**
 * Ranks `entries` by their mean gap to the fastest over `routes` (see
 * **Standings** in `CONTEXT.md`). `routes` are already filtered; a route with
 * no times for `category` is not counted, and an entry missing a time on any
 * counted route is listed in `untimed` rather than ranked.
 */
export function rankStandings(routes: readonly StandingsRoute[], entries: readonly StandingsEntry[], category: StandingsCategory): Standings {
  const counted = routes.flatMap(route => route.times[category] ?? [])
  const totals = entries.map(() => ({ pct: 0, wins: 0, timed: 0 }))
  for (const times of counted) {
    parseGaps(times).forEach((gapTenths, index) => {
      const sum = totals[index]
      if (gapTenths === null || !sum) return
      sum.pct += (gapTenths / 10) / times.fastestSec * 100
      if (gapTenths === 0) sum.wins++
      sum.timed++
    })
  }

  const rows: Omit<StandingsRow, 'rank'>[] = []
  const untimed: StandingsEntry[] = []
  if (counted.length) {
    entries.forEach((entry, index) => {
      const sum = totals[index]!
      if (sum.timed < counted.length) untimed.push(entry)
      else rows.push({ entry, meanGapPct: sum.pct / counted.length, wins: sum.wins })
    })
  }
  rows.sort((a, b) => a.meanGapPct - b.meanGapPct || b.wins - a.wins || a.entry.name.localeCompare(b.entry.name, 'en'))
  return { rows: rows.map((row, index) => ({ ...row, rank: index + 1 })), routeCount: counted.length, untimed }
}

const parsedGaps = new WeakMap<StandingsRouteTimes, (number | null)[]>()

/** A route's gaps as numbers, in the entries' order - null where an entry has no time. Parsed once per route. */
export function parseGaps(times: StandingsRouteTimes): (number | null)[] {
  let gaps = parsedGaps.get(times)
  if (!gaps) {
    gaps = times.gapTenths.split(',').map(value => value === '' ? null : Number(value))
    parsedGaps.set(times, gaps)
  }
  return gaps
}

/** A mean gap as the list prints it: "+0.42%", or "0.00%" for an entry fastest on every route. */
export function formatMeanGap(pct: number): string {
  const rounded = pct.toFixed(2)
  return rounded === '0.00' ? '0.00%' : `+${rounded}%`
}

/** The same gap as seconds lost per hour of riding - the share, in time a rider can picture. */
export function secondsPerHour(pct: number): number {
  return Math.round(pct / 100 * 3600)
}

/** The frames the routes' wheels were timed on, most common first (at most two): "the route's fastest frame" as a bike a rider can picture. */
export function usualTimingFrames(routes: readonly StandingsRoute[], category: StandingsCategory): string[] {
  const tally = new Map<string, number>()
  for (const route of routes) {
    const frame = route.times[category]?.timedOn
    if (frame) tally.set(frame, (tally.get(frame) ?? 0) + 1)
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).slice(0, 2).map(([name]) => name)
}

/** How the Wheels page says its times are worked out for `category`, naming the usual timing frames. */
export function wheelTimingNote(category: StandingsCategory, usualFrames: readonly string[]): string {
  const bike = category === 'tt' ? 'TT' : 'road'
  const usual = usualFrames.length ? ` - here mostly the ${usualFrames.join(' or the ')} -` : ''
  return `On each route, every wheelset is timed on the route's fastest ${bike} bike that takes wheels${usual} and compared with the fastest wheels on it: the list rank 1 opens on that route's page.`
}

/** Whether a stored rider profile differs from the default rider the standings were timed for. */
export function profileDiffersFromRider(profile: Pick<StandingsRider, 'weightKg' | 'heightCm' | 'powerW'>, rider: StandingsRider): boolean {
  return profile.weightKg !== rider.weightKg || profile.heightCm !== rider.heightCm || profile.powerW !== rider.powerW
}
