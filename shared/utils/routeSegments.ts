import type { Route } from 'zwift-data'
import { segments } from 'zwift-data'
import type { RouteSegmentPlacement, RouteWithMeta, SegmentSummary, SurfaceSegment } from '../types/catalog'
import type { PhysicsSurface } from '../types/physics'
import { coarsenSurfaceComposition, normalizeSurfaceComposition } from '../data/surfaceCrr'
import { sliceElevationProfile } from './elevationGeometry'
import { rescaleElevationProfile, rescaleSurfaceSegments } from './traceScale'
import { sliceSurfaceSegments, surfaceCompositionFromSegments } from './surfaceGeometry'
import { getRoutesWithMeta, getWorldName } from './catalog'
import { computeTerrain } from './routeTerrain'

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
      ...route.terrain.sprints
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
        placement: 'positional',
        hostRoutes: [{ slug: route.slug, name: route.name }]
      })
    }
  }

  // Second pass: segments no route places positionally. 51 of 335 routes
  // don't publish `segmentsOnRoute` at all, so 39 real sprint/climb segments
  // (Makuri 40's five scoring sprints among them) would otherwise not exist
  // here - but 38 of them do appear in some route's non-positional `segments`
  // membership array, which is enough to know *that* they're on the route,
  // just not where. Their length/grade come from the segment's own record;
  // the same sprint-vs-climb asymmetry as above applies (sprints without
  // gradient data stay flat, climbs without any elevation signal are skipped,
  // matching `routeClimbs.ts`). The one segment with no host at all (`prime`)
  // is skipped by the empty-`hostRoutes` guard.
  for (const segment of segments) {
    if (segment.type !== 'sprint' && segment.type !== 'climb') continue
    if (bySlug.has(segment.slug)) continue

    const hostRoutes = getRoutesWithMeta()
      .filter(route => route.segments?.includes(segment.slug))
      .map(route => ({ slug: route.slug, name: route.name }))
    if (!hostRoutes.length) continue

    const lengthKm = segment.distance
    if (!lengthKm || lengthKm <= 0) continue
    const elevationM = Math.max(0, segment.avgIncline !== undefined
      ? (segment.avgIncline / 100) * lengthKm * 1000
      : (segment.elevation ?? 0))
    if (segment.type === 'climb' && elevationM <= 0) continue
    const avgGradePercent = segment.avgIncline ?? (elevationM > 0 ? (elevationM / (lengthKm * 1000)) * 100 : 0)

    const world = getRoutesWithMeta().find(route => route.slug === hostRoutes[0]!.slug)!.world
    bySlug.set(segment.slug, {
      slug: segment.slug,
      name: segment.name,
      type: segment.type,
      world,
      worldName: getWorldName(world),
      lengthKm,
      elevationM,
      avgGradePercent,
      placement: 'membership',
      hostRoutes
    })
  }

  cachedSummaries = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name))

  // Display-stat pass: where a measured profile slice exists (the same one
  // the segment page's chart and the dynamic simulator ride), derive the
  // gain and grade the page should SHOW, so no surface ever quotes
  // zwift-data's coarse scalar next to a chart drawn from the measured road
  // (Titans Grove reverse: published 6.6%, measured ~4.3% - ZwiftInsider
  // agrees with the road). See the field docs on `SegmentSummary`: display
  // prefers these, physics deliberately does not read them.
  for (const summary of cachedSummaries) {
    const hostRoute = pickHostRoute(summary)
    const placementOnHost = hostRoute ? findPlacement(summary, hostRoute) : undefined
    const profile = placementOnHost?.perLap && hostRoute
      ? sliceElevationProfile(
          hostRoute.terrain.elevationProfile,
          placementOnMeasuredScale(hostRoute, placementOnHost.fromKm),
          placementOnMeasuredScale(hostRoute, placementOnHost.toKm)
        )
      : []
    if (profile.length < 2 || summary.lengthKm <= 0) continue
    let ascentM = 0
    for (let i = 1; i < profile.length; i++) ascentM += Math.max(0, profile[i]!.elevationM - profile[i - 1]!.elevationM)
    const netM = profile[profile.length - 1]!.elevationM
    summary.measuredElevationM = Math.round(ascentM)
    summary.measuredAvgGradePercent = Math.round((netM / (summary.lengthKm * 1000)) * 1000) / 10
  }

  return cachedSummaries
}

export function getSegmentSummary(slug: string): SegmentSummary | undefined {
  return getAllSegmentSummaries().find(s => s.slug === slug)
}

/**
 * A placement's km, converted into the coordinates the host's measured
 * arrays are in.
 *
 * zwift-data's `segmentsOnRoute` positions are measured along the route's
 * real geometry, not against its published distance: on 36 of the 37 routes
 * where the two can be told apart, the last placement lands on the community
 * Strava trace's length rather than the official one (valley-to-mountaintop's
 * summit finish ends at km 4.583 of a 4.592 km trace on a route officially
 * 5.009 km long). The measured surface and elevation arrays used to be in
 * those same trace kilometres, so slicing one with the other agreed by
 * accident; since issue #171 rescaled them onto the official distance, the
 * placement has to make the same trip or it reads the wrong stretch of road.
 *
 * Both ends scale by the same factor, so the stretch this selects is exactly
 * the one it selected before the rescale.
 */
function placementOnMeasuredScale(host: RouteWithMeta, km: number): number {
  return km * (host.surface.traceScale ?? 1)
}

/** This segment's placement on one particular host route, if that host places it positionally. */
function findPlacement(summary: SegmentSummary, hostRoute: RouteWithMeta) {
  return (summary.type === 'climb' ? hostRoute.terrain.climbs : hostRoute.terrain.sprints).find(p => p.slug === summary.slug)
}

/**
 * The host route whose measured data stands in for the segment: the first
 * host (in `hostRoutes` order, stable per build) at the highest available
 * data tier. A segment is the same physical road on every route that hosts
 * it (see `routeSegments.test.ts`), so which host is "right" is purely a
 * question of which one is best instrumented - preferring a host with a
 * lap-frame placement, measured surface segments and a measured elevation
 * profile over a blind first host is a small accuracy upgrade for segments
 * whose first host happens to be unmeasured.
 */
function pickHostRoute(summary: SegmentSummary): RouteWithMeta | undefined {
  const routes = getRoutesWithMeta()
  let best: RouteWithMeta | undefined
  let bestTier = -1
  for (const host of summary.hostRoutes) {
    const route = routes.find(r => r.slug === host.slug)
    if (!route) continue
    const placement = findPlacement(summary, route)
    const tier = !placement
      ? 0
      : !(placement.perLap && route.surface.segments)
          ? 1
          : (route.terrain.elevationProfile?.length ?? 0) > 1 ? 3 : 2
    if (tier > bestTier) {
      best = route
      bestTier = tier
      if (bestTier === 3) break
    }
  }
  return best
}

/**
 * Builds a synthetic segment-as-route object so a single climb/sprint can
 * reuse the exact same scoring/ranking/physics pipeline (`rankCombos`,
 * `estimateFinishTimeSec`, `simulateRoute`) a whole route already uses,
 * rather than duplicating any of it. The hosting route whose measured data
 * gets sliced for this segment's own stretch of road is chosen by
 * `pickHostRoute`; callers used to steer that with a `?route=` query param,
 * but hosts never meaningfully disagree about the same physical road (max
 * 4.65 surface percentage points across the whole catalog - GPS noise), so
 * the best-instrumented host is now simply everyone's default.
 */
export function routeWithMetaForSegment(summary: SegmentSummary): RouteWithMeta {
  return routeWithMetaForSegmentHost(summary, pickHostRoute(summary))
}

/**
 * `routeWithMetaForSegment` for one specific host route - exported so the
 * host-independence acceptance test can verify that every host slices the
 * same road out of its own measured data.
 */
export function routeWithMetaForSegmentHost(summary: SegmentSummary, hostRoute: RouteWithMeta | undefined): RouteWithMeta {
  const placement = hostRoute ? findPlacement(summary, hostRoute) : undefined

  const fallbackSurface: PhysicsSurface = (hostRoute?.surface.composition
    ? Object.entries(hostRoute.surface.composition).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0]
    : undefined) as PhysicsSurface ?? 'tarmac'

  // Sliced in metres (relative to the host route's own lap), then converted
  // back to km relative to the SEGMENT's own start (0..lengthKm) - matching
  // the same `SurfaceEstimate.segments` convention a normal route uses
  // (km-relative-to-lap), just rescoped. `geometryForSegment` re-derives the
  // metres form of this via `sliceSurfaceSegments` again, same as
  // `physics/routeGeometry.ts` already does per-lap.
  // Known imprecision, pre-existing: for a `!perLap` placement (segment inside
  // the lead-in) `fromKm`/`toKm` are ride-relative while `surface.segments`
  // are lap-relative, so this slice reads the wrong stretch of the lap. Rare
  // (lead-in-hosted segments on ride-relative routes only), and `pickHostRoute`
  // now prefers a `perLap` host wherever one exists.
  const slicedM = placement && hostRoute
    ? sliceSurfaceSegments(
        hostRoute.surface.segments,
        placementOnMeasuredScale(hostRoute, placement.fromKm),
        placementOnMeasuredScale(hostRoute, placement.toKm),
        fallbackSurface
      )
    : undefined
  // Onto the segment's own length, for the same reason a route's arrays are
  // put onto the route's: a stretch sliced out of a rescaled host spans the
  // host's kilometres, and the few metres by which that misses the segment's
  // own length would be a trailing gap in its geometry.
  const segmentSurfaceSegments: SurfaceSegment[] | undefined = rescaleSurfaceSegments(
    slicedM?.map(s => ({ fromKm: s.fromM / 1000, toKm: s.toM / 1000, type: s.surface })),
    summary.lengthKm
  )
  const composition = slicedM ? normalizeSurfaceComposition(surfaceCompositionFromSegments(slicedM)) : hostRoute?.surface.composition

  let surface = composition
    ? {
        ...coarsenSurfaceComposition(composition),
        composition,
        segments: segmentSurfaceSegments,
        confidence: (placement && hostRoute?.surface.segments) ? 'measured' as const : (hostRoute?.surface.confidence ?? 'heuristic' as const)
      }
    : (hostRoute?.surface ?? { road: 100, gravel: 0, cobble: 0, confidence: 'heuristic' as const })

  // A membership-only segment (`placement: 'membership'`) has no positional
  // data on any route, so the composition above is the host route's
  // whole-route mix standing in for one short stretch of it. However the
  // route itself was measured, that stand-in is a guess for the segment -
  // and a guess must never wear the measured/curated badge (see the
  // recommendation-accuracy rules), so it's capped at 'unverified'.
  if (summary.placement === 'membership' && (surface.confidence === 'measured' || surface.confidence === 'curated')) {
    surface = { ...surface, segments: undefined, confidence: 'unverified' as const }
  }

  // The segment's own stretch of the host's measured elevation profile,
  // re-based to start at {0,0} like every lap profile. Gated on `perLap`:
  // `elevationProfile` is lap-relative (issue #126's normalization) while a
  // lead-in placement's `fromKm`/`toKm` are ride-relative, so slicing the lap
  // profile with them would read the wrong stretch of road. Membership
  // segments have no placement at all, so they never get a profile - the
  // page's chart simply doesn't render for them, matching how their surface
  // confidence is capped above. This profile powers both the segment page's
  // elevation chart and the dynamic simulator's geometry (see
  // `geometryForSegment`) - with it, the sim rides the segment's real grade
  // changes instead of one average-grade line.
  const slicedProfile = (placement?.perLap && hostRoute
    ? rescaleElevationProfile(
        sliceElevationProfile(
          hostRoute.terrain.elevationProfile,
          placementOnMeasuredScale(hostRoute, placement.fromKm),
          placementOnMeasuredScale(hostRoute, placement.toKm)
        ),
        summary.lengthKm
      )
    : []) ?? []

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
    // `computeTerrain`'s own generated-data lookup is keyed by route slug, so
    // it always misses for a segment slug - the sliced profile is injected on
    // top of the scalar terrain it computes.
    terrain: {
      ...computeTerrain({ distance: summary.lengthKm, elevation: summary.elevationM } as Route),
      ...(slicedProfile.length > 1 ? { elevationProfile: slicedProfile } : {})
    },
    surface
  }
}
