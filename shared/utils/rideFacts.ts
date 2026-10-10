import type { SurfaceComposition, SurfaceEstimate, ZwiftSurfaceType } from '../types/catalog'
import { SURFACE_TYPE_LABELS } from './courseLabels'
import { surfaceFamily, type SurfaceFamily } from './silhouette'
import { formatPercent } from './units'

/**
 * The Fact row's parts (see **Fact row** in `CONTEXT.md`): its cells, its
 * surface split and the coverage note beneath it. In `shared/` with the Ride
 * statement that builds a Fact row from them, which the markdown twins read
 * on the server (issue #318).
 */

/** One cell of the spec row: the value above its small label. `family` marks a surface share, which `surfaceShareFacts` still builds for the split. */
export interface RideFact {
  value: string
  label: string
  family?: SurfaceFamily
}

/**
 * The Fact row's surface shares: one entry per non-tarmac family present,
 * its share of the lap and the surfaces it is made of in the rider's words -
 * "18.3% dirt", "3.0% wood and cobbles" - largest surface first. Tarmac is
 * the rest and goes unsaid.
 */
export function surfaceShareFacts(composition: SurfaceComposition | undefined): RideFact[] {
  if (!composition) return []
  const families: Partial<Record<SurfaceFamily, { percent: number, surfaces: [ZwiftSurfaceType, number][] }>> = {}
  for (const [surface, percent] of Object.entries(composition) as [ZwiftSurfaceType, number | undefined][]) {
    if (!percent || percent <= 0) continue
    const family = surfaceFamily(surface)
    if (family === 'tarmac') continue
    const entry = families[family] ??= { percent: 0, surfaces: [] }
    entry.percent += percent
    entry.surfaces.push([surface, percent])
  }
  return (['dirt', 'rough'] as const).flatMap((family) => {
    const entry = families[family]
    if (!entry) return []
    const names = entry.surfaces.sort((a, b) => b[1] - a[1]).map(([surface]) => SURFACE_TYPE_LABELS[surface].toLowerCase())
    const words = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]!
    return [{ value: formatPercent(entry.percent), label: words, family }]
  })
}

/**
 * How many different named climbs and sprints a course has, however many
 * times it passes each - from a route's terrain or a drawn course's bands.
 */
export function namedClimbCounts(course: { climbs: readonly { slug: string }[], sprints: readonly { slug: string }[] }): { climbs: number, sprints: number } {
  return {
    climbs: new Set(course.climbs.map(climb => climb.slug)).size,
    sprints: new Set(course.sprints.map(sprint => sprint.slug)).size
  }
}

/** "2 named climbs, 1 sprint" as a fact, or nothing when the ride has neither. */
export function climbCountFact({ climbs, sprints }: { climbs: number, sprints: number }): RideFact | undefined {
  if (!climbs && !sprints) return undefined
  if (!climbs) return { value: String(sprints), label: sprints === 1 ? 'sprint' : 'sprints' }
  const label = `named climb${climbs === 1 ? '' : 's'}${sprints ? `, ${sprints} sprint${sprints === 1 ? '' : 's'}` : ''}`
  return { value: String(climbs), label }
}

/**
 * What the distance cell's label says, now that the laps and lead-in
 * sentence is gone: the lead-in and the laps ride in the label, so the
 * number above them is one whole ride. `laps` is undefined where the page
 * has a laps cell of its own (a race) or no laps at all, and the label then
 * names the lead-in alone, or says `distance`.
 */
export function distanceLabel({ laps, leadInKm }: { laps?: number, leadInKm: number }): string {
  const leadIn = `${leadInKm.toFixed(1)} km lead-in`
  if (laps === undefined) return leadInKm > 0 ? `with the ${leadIn}` : 'distance'
  const lapsText = `${laps} lap${laps === 1 ? '' : 's'}`
  if (leadInKm <= 0) return lapsText
  return laps === 1 ? `with the ${leadIn}` : `${lapsText} + ${leadIn}`
}

/** A ride's surface as the spec row draws it: each family's share, and whether there is anything but tarmac. */
export interface SurfaceSplit {
  /** Tarmac, dirt and rough in that order, each with its share in percent; families with no share are left out. */
  parts: { family: SurfaceFamily, percent: number }[]
  /** The key beside the bar: "78.6% tarmac", "18.3% dirt", "3.0% wood and cobbles". */
  key: { family: SurfaceFamily, text: string }[]
  allTarmac: boolean
}

export function surfaceSplit(composition: SurfaceComposition | undefined): SurfaceSplit | undefined {
  if (!composition) return undefined
  const others = surfaceShareFacts(composition)
  if (!others.length) return Object.values(composition).some(percent => percent && percent > 0) ? { parts: [], key: [], allTarmac: true } : undefined
  const share = (family: SurfaceFamily) => Object.entries(composition)
    .filter(([surface]) => surfaceFamily(surface) === family)
    .reduce((sum, [, percent]) => sum + (percent ?? 0), 0)
  const tarmac = share('tarmac')
  return {
    parts: [
      ...(tarmac > 0 ? [{ family: 'tarmac' as const, percent: tarmac }] : []),
      ...others.map(fact => ({ family: fact.family!, percent: share(fact.family!) }))
    ],
    key: [
      ...(tarmac > 0 ? [{ family: 'tarmac' as const, text: `${formatPercent(tarmac)} tarmac` }] : []),
      ...others.map(fact => ({ family: fact.family!, text: `${fact.value} ${fact.label}` }))
    ],
    allTarmac: false
  }
}

/**
 * How much the model actually knows about where the surfaces are - the
 * `confidence` ladder on `SurfaceEstimate`, in rider words. "Mapped" needs
 * positioned stretches, not just a measured mix: the dynamic physics and the
 * speed chart use the positions, and a measured route whose trace lost them
 * rides on one blended value like a curated one does.
 */
export function surfaceCoverageLine(surface: SurfaceEstimate): string {
  const mapped = (surface.segments?.length ?? 0) > 0
  if (surface.confidence === 'measured') return mapped ? 'Mapped surfaces' : 'Measured surface mix; locations unavailable'
  if (surface.confidence === 'curated') return 'Curated surface estimate; locations unavailable'
  if (surface.confidence === 'unverified') return 'Surface unverified; road assumed by model'
  return 'Surface unmapped; road assumed by model'
}

/**
 * The Fact row's coverage note: the coverage line as a sentence, or nothing
 * when the surfaces are mapped - the common case, which needs no caveat.
 */
export function surfaceCoverageNote(surface: SurfaceEstimate): string | undefined {
  const mapped = surface.confidence === 'measured' && (surface.segments?.length ?? 0) > 0
  return mapped ? undefined : `${surfaceCoverageLine(surface)}.`
}
