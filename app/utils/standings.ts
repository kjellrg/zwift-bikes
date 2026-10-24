import type { StandingsCategory, StandingsEntry, StandingsRider, StandingsRoute, StandingsRouteTimes } from '#shared/types/standings'
import { TERRAIN_LABELS } from '#shared/utils/courseLabels'

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
  /** The routes it is the fastest on, in the order the filtered routes came in; its "Fastest on" count is their number. */
  wonOn: StandingsRoute[]
}

export interface Standings {
  rows: StandingsRow[]
  /** How many routes the rows average over: those of the filtered routes with times for the category. */
  routeCount: number
  /** Entries left out because some of those routes have no time for them - a mean over fewer routes is not comparable. */
  untimed: StandingsEntry[]
}

/** A gap in tenths of a second as a share of its route's fastest time, in percent. */
const gapShare = (gapTenths: number, times: StandingsRouteTimes) => (gapTenths / 10) / times.fastestSec * 100

/**
 * Ranks `entries` by their mean gap to the fastest over `routes` (see
 * **Standings** in `CONTEXT.md`). `routes` are already filtered; a route with
 * no times for `category` is not counted, and an entry missing a time on any
 * counted route is listed in `untimed` rather than ranked.
 */
export function rankStandings(routes: readonly StandingsRoute[], entries: readonly StandingsEntry[], category: StandingsCategory): Standings {
  const counted = routes.flatMap((route) => {
    const times = route.times[category]
    return times ? [{ route, times }] : []
  })
  const totals = entries.map(() => ({ pct: 0, wonOn: [] as StandingsRoute[], timed: 0 }))
  for (const { route, times } of counted) {
    parseGaps(times).forEach((gapTenths, index) => {
      const sum = totals[index]
      if (gapTenths === null || !sum) return
      sum.pct += gapShare(gapTenths, times)
      if (gapTenths === 0) sum.wonOn.push(route)
      sum.timed++
    })
  }

  const rows: Omit<StandingsRow, 'rank'>[] = []
  const untimed: StandingsEntry[] = []
  if (counted.length) {
    entries.forEach((entry, index) => {
      const sum = totals[index]!
      if (sum.timed < counted.length) untimed.push(entry)
      else rows.push({ entry, meanGapPct: sum.pct / counted.length, wonOn: sum.wonOn })
    })
  }
  rows.sort((a, b) => a.meanGapPct - b.meanGapPct || b.wonOn.length - a.wonOn.length || a.entry.name.localeCompare(b.entry.name, 'en'))
  return { rows: rows.map((row, index) => ({ ...row, rank: index + 1 })), routeCount: counted.length, untimed }
}

/** A route as the Standings Overlays list and link it. */
export interface StandingsRouteRef {
  slug: string
  name: string
  worldName: string
  terrainLabel: string
}

const routeRef = ({ slug, name, worldName, terrain }: StandingsRoute): StandingsRouteRef => ({ slug, name, worldName, terrainLabel: TERRAIN_LABELS[terrain] })

/** A route's page in the category the standings are showing: the route page ranks road bikes unless told the Time trial category. */
export const routeLink = (slug: string, category: StandingsCategory) => `/routes/${slug}${category === 'tt' ? '?category=tt' : ''}`

/** What the Fastest on Overlay shows: the routes one entry is fastest on, ready to list and link. */
export interface StandingsWinsRecord {
  /** The bike's or wheelset's name. */
  name: string
  /** The category the standings were showing, which each route links in: see `routeLink`. */
  category: StandingsCategory
  routes: StandingsRouteRef[]
}

/** The Fastest on Overlay's record for `row`: its routes by name, each linking to its page in the category the standings are showing. */
export function winsRecord(row: Pick<StandingsRow, 'entry' | 'wonOn'>, category: StandingsCategory): StandingsWinsRecord {
  return {
    name: row.entry.name,
    category,
    routes: row.wonOn
      .map(routeRef)
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  }
}

/** One route's gap for one bike: in seconds, and as a share of that route's fastest time. */
export interface StandingsRouteGap extends StandingsRouteRef {
  gapPct: number
  gapSec: number
}

/**
 * The bike just ahead of, or just behind, another in the standings on screen,
 * every number told from the neighbour's side. `gapPct` is how far apart their
 * mean shares are, which is what ranks them; `gapSec` is how many seconds
 * slower than this bike it is on average - negative when it is faster. The two
 * can disagree in sign for bikes ranked next to each other, because the
 * seconds weigh a long route more heavily.
 */
export interface StandingsNeighbour {
  name: string
  gapPct: number
  gapSec: number
  /** Of the routes both have a time on: how many the neighbour is faster on, slower on, and level on. */
  fasterOn: number
  slowerOn: number
  levelOn: number
}

/** What the bike Overlay shows of a bike's place in the standings on screen, fixed when it is opened. */
export interface StandingsBikeRecord {
  /** The frame's id, which is also what `/api/bikes/{id}` looks it up by. */
  frameId: number
  name: string
  /** The category the standings were showing, which each route links in: see `routeLink`. */
  category: StandingsCategory
  rank: number
  /** How many bikes are ranked: the denominator of the rank. */
  ranked: number
  meanGapPct: number
  /** The mean of its gap in seconds on the filtered routes: a feel for the size of the share, which is what ranks it. */
  meanGapSec: number
  /** How many of the routes it is the fastest on. */
  wins: number
  routeCount: number
  /** Mean gap per terrain class, over the filtered routes of that class; classes with no route are left out. */
  terrain: { label: string, routeCount: number, meanGapPct: number, meanGapSec: number }[]
  /** The bikes ranked either side of it; the fastest has none ahead and the slowest none behind. */
  ahead?: StandingsNeighbour
  behind?: StandingsNeighbour
  /** The routes it loses least on, then the ones it loses most on, three each and never the same route twice. */
  closest: StandingsRouteGap[]
  furthest: StandingsRouteGap[]
  /**
   * Set for the fastest bike, which cannot be measured against itself: the
   * runner-up's name. The two lists above are then margins to that bike,
   * smallest and largest by size, with `gapPct` and `gapSec` negative where
   * this bike is ahead of it.
   */
  marginAgainst?: string
  /** With `marginAgainst`: how many of `routeCount` the margins cover - the routes the runner-up also has a time on. */
  marginRouteCount?: number
}

/** What a set of standings is ranked from: the filtered routes, the entries in the order the routes' gaps are in, and the category. */
export interface StandingsScope {
  routes: readonly StandingsRoute[]
  entries: readonly StandingsEntry[]
  category: StandingsCategory
}

/** "1 route", "3 routes". */
export const routesLabel = (count: number) => `${count} ${count === 1 ? 'route' : 'routes'}`

const ROUTES_SHOWN = 3

const mean = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

/**
 * The bike Overlay's record for `row`: the same numbers the row prints, plus
 * where on the filtered routes they come from - by terrain, and the routes it
 * is closest to and furthest from the fastest on - and the bikes ranked either
 * side of it. `rows` are the standings on screen, ranked from `scope`.
 */
export function bikeRecord(row: StandingsRow, rows: readonly StandingsRow[], { routes, entries, category }: StandingsScope): StandingsBikeRecord {
  const timedGaps = (entryId: string) => {
    const index = entries.findIndex(entry => entry.id === entryId)
    return routes.flatMap((route) => {
      const times = route.times[category]
      const gapTenths = times && index >= 0 ? parseGaps(times)[index] : null
      if (!times || gapTenths === null || gapTenths === undefined) return []
      return [{ route, gapSec: gapTenths / 10, gapPct: gapShare(gapTenths, times) }]
    })
  }

  const gaps = timedGaps(row.entry.id)
  const meanGapSec = mean(gaps.map(gap => gap.gapSec))
  const terrain = Object.entries(TERRAIN_LABELS).flatMap(([key, label]) => {
    const onTerrain = gaps.filter(gap => gap.route.terrain === key)
    return onTerrain.length
      ? [{ label, routeCount: onTerrain.length, meanGapPct: mean(onTerrain.map(gap => gap.gapPct)), meanGapSec: mean(onTerrain.map(gap => gap.gapSec)) }]
      : []
  })

  const neighbour = (other: StandingsRow | undefined): StandingsNeighbour | undefined => {
    if (!other) return undefined
    const otherGaps = new Map(timedGaps(other.entry.id).map(gap => [gap.route.slug, gap.gapSec]))
    // Seconds the neighbour loses to this bike on each route both are timed on: negative where it is faster.
    const behindBy = gaps.flatMap((gap) => {
      const otherSec = otherGaps.get(gap.route.slug)
      return otherSec === undefined ? [] : [otherSec - gap.gapSec]
    })
    return {
      name: other.entry.name,
      gapPct: Math.abs(other.meanGapPct - row.meanGapPct),
      gapSec: mean([...otherGaps.values()]) - meanGapSec,
      fasterOn: behindBy.filter(diff => diff < 0).length,
      slowerOn: behindBy.filter(diff => diff > 0).length,
      levelOn: behindBy.filter(diff => diff === 0).length
    }
  }

  // The fastest bike has no one to be close to or far from "the fastest": it
  // is the fastest, on most routes at 0. Against the runner-up the same lists
  // say something, as a margin (negative: ahead of it) rather than a gap.
  const runnerUp = row.rank === 1 ? rows.find(other => other.rank === 2) : undefined
  const runnerGaps = new Map(runnerUp ? timedGaps(runnerUp.entry.id).map(gap => [gap.route.slug, gap]) : [])
  const routesBySmallestGap = gaps
    .flatMap(({ route, gapPct, gapSec }) => {
      const other = runnerUp ? runnerGaps.get(route.slug) : undefined
      if (runnerUp && !other) return []
      return [{ ...routeRef(route), gapPct: gapPct - (other?.gapPct ?? 0), gapSec: gapSec - (other?.gapSec ?? 0) }]
    })
    .sort((a, b) => Math.abs(a.gapPct) - Math.abs(b.gapPct) || a.name.localeCompare(b.name, 'en'))
  // Against the fastest, the routes it wins are no near-miss: they are left
  // out so the lists show where it loses least and most.
  const listed = runnerUp ? routesBySmallestGap : routesBySmallestGap.filter(gap => gap.gapSec !== 0)
  return {
    frameId: Number(row.entry.id),
    name: row.entry.name,
    category,
    rank: row.rank,
    ranked: rows.length,
    meanGapPct: row.meanGapPct,
    meanGapSec,
    wins: row.wonOn.length,
    routeCount: gaps.length,
    terrain,
    ahead: neighbour(rows.find(other => other.rank === row.rank - 1)),
    behind: neighbour(rows.find(other => other.rank === row.rank + 1)),
    ...(runnerUp ? { marginAgainst: runnerUp.entry.name, marginRouteCount: routesBySmallestGap.length } : {}),
    closest: listed.slice(0, ROUTES_SHOWN),
    furthest: listed.slice(Math.max(ROUTES_SHOWN, listed.length - ROUTES_SHOWN)).reverse()
  }
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

/** A route's or mean gap as a share, where one that rounds to nothing but is not nothing is "<0.01%": "0.00%" is only for losing nothing at all. */
export function formatGapShare(pct: number): string {
  return formatMeanGap(pct) === '0.00%' && pct > 0 ? '<0.01%' : formatMeanGap(pct)
}

/** A gap in seconds as the Overlay prints it beside a share: "2.1 s", or "<0.1 s" for one too small to show. */
export function formatGapSeconds(seconds: number): string {
  return seconds > 0 && seconds < 0.05 ? '<0.1 s' : `${seconds.toFixed(1)} s`
}

/**
 * A neighbour's average seconds against this bike in words, from its signed
 * `gapSec` (negative: faster). Said by the sign of the seconds, not by where
 * the bike is ranked: the ranking goes by share, so a neighbour can be a
 * little slower in seconds than the bike ranked behind it.
 */
export function formatNeighbourSeconds(seconds: number): string {
  return Math.abs(seconds) < 0.05
    ? 'about the same per route on average'
    : `${formatGapSeconds(Math.abs(seconds))} ${seconds < 0 ? 'faster' : 'slower'} per route on average`
}

/** A margin to the runner-up in words, from its signed share (negative: ahead): "0.02% ahead", "0.03% behind", or "level". */
export function formatMargin(pct: number): string {
  const rounded = Math.abs(pct).toFixed(2)
  if (rounded === '0.00') return 'level'
  return `${rounded}% ${pct < 0 ? 'ahead' : 'behind'}`
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
