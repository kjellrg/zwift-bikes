import generated from '../../shared/data/standings.generated.json'
import type { StandingsCategory, StandingsData, StandingsEntry, StandingsKind, StandingsRider, StandingsRoute, StandingsRouteTimes } from '../../shared/types/standings'
import { STANDINGS_CATEGORIES } from '../../shared/types/standings'
import { getWorlds } from '../../shared/utils/catalog'
import { allRouteCards } from './routeCardCatalog'

/**
 * The Standings pages' data (see **Standings** in `CONTEXT.md`), built from
 * the table `scripts/standings/compute-standings.mjs` commits: every route's
 * default Ranking with every frame on it, and the Wheel alternatives of its
 * fastest road and TT frames that take wheels. Nothing is timed here - the
 * table is what a route page would show for the default rider, and this only
 * turns it into gaps and joins it to the route cards the filters read.
 *
 * The catalog only changes on deploy, so each page's data is built once per
 * worker instance, on first use, and reused - as the route cards are.
 */

/** The committed table, as the script writes it. */
interface StandingsTable {
  fingerprint: string
  rider: StandingsRider
  frames: { id: number, name: string, category: string, otherPaints?: string[] }[]
  wheels: { key: string, name: string }[]
  routes: {
    slug: string
    /** Per frame, in `frames` order: the route page row's finish time. */
    frameSec: (number | null)[]
    /** Per category: the frame the wheels were timed on, and each wheel's time on it, in `wheels` order. */
    wheels: Partial<Record<StandingsCategory, { frameId: number, sec: (number | null)[] }>>
  }[]
}

const table = generated as StandingsTable

const cached: Partial<Record<StandingsKind, StandingsData>> = {}

/** The data one Standings page averages - see the module comment. */
export function standingsData(kind: StandingsKind): StandingsData {
  return cached[kind] ??= buildStandingsData(kind)
}

function buildStandingsData(kind: StandingsKind): StandingsData {
  const cards = new Map(allRouteCards().map(card => [card.slug, card]))
  const timedRoutes = table.routes.filter(route => cards.has(route.slug))
  const columns = kind === 'bikes' ? frameColumns() : wheelColumns()
  const routes = timedRoutes.map((route): StandingsRoute => {
    const { slug, name, world, worldName, distance, elevation, terrain, gravel, cobble } = cards.get(route.slug)!
    const times: StandingsRoute['times'] = {}
    for (const category of STANDINGS_CATEGORIES) {
      const routeTimes = columns.times(route, category)
      if (routeTimes) times[category] = routeTimes
    }
    return { slug, name, world, worldName, distance, elevation, terrain, gravel, cobble, times }
  })
  return {
    kind,
    rider: table.rider,
    entries: columns.entries,
    routes,
    worlds: getWorlds().map(({ slug, name }) => ({ slug, name })),
    untimedRoutes: cards.size - timedRoutes.length
  }
}

/** The fastest of `seconds` and every other one's gap to it, in tenths; undefined when nothing has a time. */
function gapsToFastest(seconds: (number | null)[]): Pick<StandingsRouteTimes, 'fastestSec' | 'gapTenths'> | undefined {
  const timed = seconds.filter((value): value is number => value !== null)
  if (!timed.length) return undefined
  const fastestSec = Math.min(...timed)
  return { fastestSec, gapTenths: seconds.map(value => value === null ? '' : String(Math.round((value - fastestSec) * 10))).join(',') }
}

interface EntryColumns {
  entries: Record<StandingsCategory, StandingsEntry[]>
  times: (route: StandingsTable['routes'][number], category: StandingsCategory) => StandingsRouteTimes | undefined
}

/** Bikes: each category's frames, each timed on its own fastest wheels, against the category's fastest frame. */
function frameColumns(): EntryColumns {
  const indices = Object.fromEntries(STANDINGS_CATEGORIES.map(category => [
    category,
    table.frames.flatMap((frame, index) => frame.category === category ? [index] : [])
  ])) as Record<StandingsCategory, number[]>
  return {
    entries: Object.fromEntries(STANDINGS_CATEGORIES.map(category => [
      category,
      indices[category].map(index => frameEntry(table.frames[index]!))
    ])) as Record<StandingsCategory, StandingsEntry[]>,
    times: (route, category) => gapsToFastest(indices[category].map(index => route.frameSec[index] ?? null))
  }
}

function frameEntry(frame: StandingsTable['frames'][number]): StandingsEntry {
  return { id: String(frame.id), name: frame.name, ...(frame.otherPaints ? { otherPaints: frame.otherPaints } : {}) }
}

/**
 * Wheels: every wheelset on each route's fastest frame that takes wheels,
 * against the fastest wheels on that frame. Wheels that time identically on
 * every route are listed once - as the Wheel alternatives list collapses
 * them - under the plainest name, with the others beside it.
 */
function wheelColumns(): EntryColumns {
  const groups = new Map<string, number[]>()
  table.wheels.forEach((_, index) => {
    const signature = JSON.stringify(table.routes.map(route => STANDINGS_CATEGORIES.map(category => route.wheels[category]?.sec[index] ?? null)))
    groups.set(signature, [...(groups.get(signature) ?? []), index])
  })
  const wheelAt = (index: number) => table.wheels[index]!
  const byPlainestName = (a: number, b: number) => wheelAt(a).name.length - wheelAt(b).name.length || wheelAt(a).key.localeCompare(wheelAt(b).key, 'en')
  const leads = [...groups.values()].map(members => [...members].sort(byPlainestName))
  const entries: StandingsEntry[] = leads.map(([lead, ...others]) => ({
    id: wheelAt(lead!).key,
    name: wheelAt(lead!).name,
    ...(others.length ? { sameTimes: others.map(other => wheelAt(other).name) } : {})
  }))
  const frameNames = new Map(table.frames.map(frame => [frame.id, frame.name]))
  return {
    entries: Object.fromEntries(STANDINGS_CATEGORIES.map(category => [category, entries])) as Record<StandingsCategory, StandingsEntry[]>,
    times: (route, category) => {
      const list = route.wheels[category]
      const gaps = list && gapsToFastest(leads.map(([lead]) => list.sec[lead!] ?? null))
      return gaps && { ...gaps, timedOn: frameNames.get(list.frameId) }
    }
  }
}
