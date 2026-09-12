import type { SurfaceComposition, SurfaceEstimate } from '../../shared/types/catalog'
import { SURFACE_TYPE_LABELS } from './labels'

/**
 * The surfaces a lap is made of, by name and largest share first - the
 * briefing's compact form of the composition. The percentages themselves
 * stay in the surface-details panel: at a glance "Tarmac / Cobbles / Wood"
 * says what the ride feels like, and "95.3% / 2.6% / 2.1%" does not.
 */
export function surfaceNamesLine(composition: SurfaceComposition | undefined): string | undefined {
  if (!composition) return undefined
  const names = (Object.entries(composition) as [keyof SurfaceComposition, number | undefined][])
    .filter((entry): entry is [keyof SurfaceComposition, number] => (entry[1] ?? 0) > 0)
    .sort((first, second) => second[1] - first[1])
    .map(([surface]) => SURFACE_TYPE_LABELS[surface])
  return names.length ? names.join(' / ') : undefined
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
 * The one-line warning beside a finish time whose course inputs are partly
 * missing. Undefined when nothing is - the common case, so the line only
 * appears where it changes how much to trust the number.
 */
export function limitedCourseDataNote(coverage: { hasElevationProfile: boolean, hasSurfaceLocations: boolean }): string | undefined {
  if (coverage.hasElevationProfile && coverage.hasSurfaceLocations) return undefined
  const missing = !coverage.hasElevationProfile && !coverage.hasSurfaceLocations
    ? 'elevation and surface locations unavailable'
    : !coverage.hasElevationProfile ? 'elevation profile unavailable' : 'surface locations unavailable'
  return `Limited route data: ${missing}.`
}
