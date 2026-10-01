import type { SurfaceComposition, ZwiftSurfaceType } from '../../shared/types/catalog'
import { surfaceFamily, type SurfaceFamily } from '#shared/utils/silhouette'
import { formatPercent, SURFACE_TYPE_LABELS } from './labels'

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

/** "2 named climbs, 1 sprint" as a fact, or nothing when the ride has neither. */
export function climbCountFact(climbs: number, sprints: number): RideFact | undefined {
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
