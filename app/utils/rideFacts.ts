import type { SurfaceComposition, ZwiftSurfaceType } from '../../shared/types/catalog'
import { surfaceFamily, type SurfaceFamily } from '#shared/utils/silhouette'
import { formatPercent, SURFACE_TYPE_LABELS } from './labels'

/** One entry of the Fact row: a number in bold ink, its words, and a surface swatch when it is a surface share. */
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
