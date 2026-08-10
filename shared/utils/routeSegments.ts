import type { Route } from 'zwift-data'
import { segments } from 'zwift-data'
import type { RouteSegmentPlacement, RouteWithMeta, SegmentSummary, SurfaceSegment } from '../types/catalog'
import type { PhysicsSurface } from '../types/physics'
import { coarsenSurfaceComposition, normalizeSurfaceComposition } from '../data/surfaceCrr'
import { sliceSurfaceSegments, surfaceCompositionFromSegments } from './surfaceGeometry'
import { getRoutesWithMeta, getWorldName } from './catalog'
import { computeTerrain } from './routeTerrain'
import { expandOccurrencesForLaps, type SegmentOccurrence } from './routeClimbs'

/**
 * `zwift-data`'s `segments` catalog also has real sprint segments (61 of
 * them, alongside the 45 climbs `routeClimbs.ts` already reads) - same
 * `segmentsOnRoute` cross-reference, but unlike climbs, a sprint with no
 * published `avgIncline`/`elevation` is kept as flat (`elevationM: 0`)
 * rather than skipped, since most sprints legitimately have no gradient
 * data at all (see the surrounding investigation in this repo's history).
 */
const segmentsBySlug = new Map(segments.map(segment => [segment.slug, segment]))

export function getRouteSprints(route: Route): RouteSegmentPlacement[] {
  if (!route.segmentsOnRoute?.length) return []
  const leadInKm = route.leadInDistance ?? 0

  const sprints: RouteSegmentPlacement[] = []
  for (const placement of route.segmentsOnRoute) {
    const segment = segmentsBySlug.get(placement.segment)
    if (!segment || segment.type !== 'sprint') continue

    const lengthKm = placement.to - placement.from
    if (lengthKm <= 0) continue

    const elevationM = Math.max(0, segment.avgIncline !== undefined
      ? (segment.avgIncline / 100) * lengthKm * 1000
      : (segment.elevation ?? 0))
    const avgGradePercent = segment.avgIncline ?? (elevationM > 0 ? (elevationM / (lengthKm * 1000)) * 100 : 0)
    const perLap = placement.from >= leadInKm
    const fromKm = perLap ? placement.from - leadInKm : placement.from

    sprints.push({
      name: segment.name,
      slug: segment.slug,
      type: 'sprint',
      fromKm,
      toKm: fromKm + lengthKm,
      lengthKm,
      elevationM,
      avgGradePercent,
      perLap
    })
  }

  return sprints.sort((a, b) => a.fromKm - b.fromKm)
}

/** Expands a route's sprints into one entry per actual occurrence for a given lap count - see `expandOccurrencesForLaps`. */
export function expandSprintsForLaps(route: RouteWithMeta, laps: number): (RouteSegmentPlacement & SegmentOccurrence)[] {
  return expandOccurrencesForLaps(getRouteSprints(route), route, laps)
}

let cachedSummaries: SegmentSummary[] | undefined

/**
 * Every rankable segment (climb or sprint - the 15 generic "segment"-type
 * `zwift-data` entries, mostly lap/loop boundary markers, aren't included),
 * aggregated across every route that hosts it. Cached like `getRoutesWithMeta`.
 */
export function getAllSegmentSummaries(): SegmentSummary[] {
  if (cachedSummaries) return cachedSummaries

  const bySlug = new Map<string, SegmentSummary>()
  for (const route of getRoutesWithMeta()) {
    const placements: RouteSegmentPlacement[] = [
      ...route.terrain.climbs.map(climb => ({ ...climb, type: 'climb' as const })),
      ...getRouteSprints(route)
    ]
    for (const placement of placements) {
      const existing = bySlug.get(placement.slug)
      if (existing) {
        // A segment can occur more than once on the same route (e.g. once in
        // the lead-in and again per-lap) - only list the route once.
        if (!existing.hostRoutes.some(h => h.slug === route.slug)) existing.hostRoutes.push({ slug: route.slug, name: route.name })
        continue
      }
      bySlug.set(placement.slug, {
        slug: placement.slug,
        name: placement.name,
        type: placement.type,
        climbType: placement.climbType,
        world: route.world,
        worldName: getWorldName(route.world),
        lengthKm: placement.lengthKm,
        elevationM: placement.elevationM,
        avgGradePercent: placement.avgGradePercent,
        hostRoutes: [{ slug: route.slug, name: route.name }]
      })
    }
  }

  cachedSummaries = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name))
  return cachedSummaries
}

export function getSegmentSummary(slug: string): SegmentSummary | undefined {
  return getAllSegmentSummaries().find(s => s.slug === slug)
}

/**
 * Builds a synthetic segment-as-route object so a single climb/sprint can
 * reuse the exact same scoring/ranking/physics pipeline (`rankCombos`,
 * `estimateFinishTimeSec`, `simulateRoute`) a whole route already uses,
 * rather than duplicating any of it. `preferredRouteSlug` (e.g. the route a
 * segment card was clicked from) picks which hosting route's measured
 * surface data to slice for this segment's own stretch of road, falling
 * back to the first hosting route's whole-route surface estimate when no
 * measured positional data covers this segment.
 */
export function routeWithMetaForSegment(summary: SegmentSummary, preferredRouteSlug?: string): RouteWithMeta {
  const routes = getRoutesWithMeta()
  const hostRoute = (preferredRouteSlug && routes.find(r => r.slug === preferredRouteSlug && summary.hostRoutes.some(h => h.slug === preferredRouteSlug)))
    || routes.find(r => r.slug === summary.hostRoutes[0]?.slug)

  const placement = hostRoute
    ? (summary.type === 'climb' ? hostRoute.terrain.climbs : getRouteSprints(hostRoute)).find(p => p.slug === summary.slug)
    : undefined

  const fallbackSurface: PhysicsSurface = (hostRoute?.surface.composition
    ? Object.entries(hostRoute.surface.composition).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0]
    : undefined) as PhysicsSurface ?? 'tarmac'

  // Sliced in metres (relative to the host route's own lap), then converted
  // back to km relative to the SEGMENT's own start (0..lengthKm) - matching
  // the same `SurfaceEstimate.segments` convention a normal route uses
  // (km-relative-to-lap), just rescoped. `geometryForSegment` re-derives the
  // metres form of this via `sliceSurfaceSegments` again, same as
  // `physics/routeGeometry.ts` already does per-lap.
  const slicedM = placement
    ? sliceSurfaceSegments(hostRoute?.surface.segments, placement.fromKm, placement.toKm, fallbackSurface)
    : undefined
  const segmentSurfaceSegments: SurfaceSegment[] | undefined = slicedM?.map(s => ({
    fromKm: s.fromM / 1000,
    toKm: s.toM / 1000,
    type: s.surface
  }))
  const composition = slicedM ? normalizeSurfaceComposition(surfaceCompositionFromSegments(slicedM)) : hostRoute?.surface.composition

  const surface = composition
    ? {
        ...coarsenSurfaceComposition(composition),
        composition,
        segments: segmentSurfaceSegments,
        confidence: (placement && hostRoute?.surface.segments) ? 'measured' as const : (hostRoute?.surface.confidence ?? 'heuristic' as const)
      }
    : (hostRoute?.surface ?? { road: 100, gravel: 0, cobble: 0, confidence: 'heuristic' as const })

  return {
    slug: summary.slug,
    name: summary.name,
    world: summary.world,
    worldName: summary.worldName,
    distance: summary.lengthKm,
    elevation: summary.elevationM,
    sports: hostRoute?.sports ?? ['cycling'],
    eventOnly: false,
    levelLocked: false,
    lap: false,
    supportsTT: hostRoute?.supportsTT ?? true,
    supportsMeetups: false,
    segments: [],
    segmentsOnRoute: [],
    terrain: computeTerrain({ distance: summary.lengthKm, elevation: summary.elevationM } as Route),
    surface
  }
}
