import type { SegmentSummary } from '../types/catalog'

const gainOf = (segment: SegmentSummary) => segment.measuredElevationM ?? segment.elevationM

/**
 * One world's segments in the order every listing gives them: the climbs by
 * climbing gained, most first, then the sprints by name. Written once so the
 * segments page's world groups and a World page (#58) cannot order a world
 * differently - a climb reads the same wherever its world is listed.
 *
 * Catalog-free on purpose: the segments page imports this into the browser
 * bundle, which `scripts/check-client-bundle.mjs` keeps clear of the catalog.
 */
export function climbsThenSprints(segments: readonly SegmentSummary[]): { climbs: SegmentSummary[], sprints: SegmentSummary[] } {
  return {
    climbs: segments.filter(segment => segment.type === 'climb').sort((a, b) => gainOf(b) - gainOf(a) || a.name.localeCompare(b.name)),
    sprints: segments.filter(segment => segment.type === 'sprint').sort((a, b) => a.name.localeCompare(b.name))
  }
}
