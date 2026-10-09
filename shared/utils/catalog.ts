import { bikeFrames, routes, worlds } from 'zwift-data'
import type { ClassifiedBikeFrame, RouteSummary, RouteWithMeta } from '../types/catalog'
import { classifyBikeFrame } from './classifyBikeFrame'
import { SUPPLEMENT_FRAMES, UNLOCALIZED_FRAME_NAME, applyFrameSupplement } from '../data/frameSupplement'
import { eventLeadIn } from '../data/routeEventLeadIns'
import { SUPPLEMENT_SEGMENT_HOSTS } from '../data/segmentHostSupplement'
import { getGeneratedSegmentPlacements } from '../data/segmentPlacements'
import { computeTerrain, estimateSurface } from './routeTerrain'

const worldNameBySlug = new Map<string, string>(worlds.map(w => [w.slug, w.name]))

export function getWorldName(slug: string): string {
  return worldNameBySlug.get(slug) ?? slug
}

/**
 * zwift-data is generated from Zwift's game dictionary, and a frame that
 * shipped before its localized string did carries the raw dictionary key as
 * its name (`Canyon LOC_ENTITLEMENT_CYCLING_BIKE_CANYON_AEROADCFR2026_NAME`,
 * id 2303301376, in zwift-data 1.50). It is an upstream gap, not a bike the
 * catalog can describe: no ZwiftInsider data can be keyed to it, the garage
 * picker and the bikes API would show the placeholder verbatim, and it would
 * rank as an estimated standard frame. Dropped here, at the one place every
 * frame enters the catalog, until zwift-data ships the real name - at which
 * point it appears on its own. `validate-speed-data.mjs` warns per
 * placeholder so a new one is noticed, without failing the build on
 * something the repo cannot fix - unless `frameSupplement.ts` carries the
 * frame under its real or a provisional name, in which case that entry is
 * the bike (the CFR above is "Canyon Aeroad CFR - CANYON//SRAM", #272).
 *
 * The frame catalog is zwift-data plus the supplement, merged here at the
 * one place every frame enters it (the wheel twin is `getWheelsets()`).
 */
export { UNLOCALIZED_FRAME_NAME } from '../data/frameSupplement'

let cachedFrames: ClassifiedBikeFrame[] | undefined
let cachedRoutes: RouteWithMeta[] | undefined

export function getFrames(): ClassifiedBikeFrame[] {
  if (!cachedFrames) cachedFrames = applyFrameSupplement(bikeFrames, SUPPLEMENT_FRAMES).filter(f => !UNLOCALIZED_FRAME_NAME.test(f.name)).map(f => classifyBikeFrame(f))
  return cachedFrames
}

export function getFrameById(id: number): ClassifiedBikeFrame | undefined {
  return getFrames().find(f => f.id === id)
}

export function getRoutesWithMeta(): RouteWithMeta[] {
  if (!cachedRoutes) {
    cachedRoutes = routes
      // Routes without a stable slug can't be linked to reliably.
      .filter(r => r.slug)
      .map((route) => {
        // Applied here, once, so every consumer sees the same ride: route
        // totals, the finish-time estimate, the simulator's geometry and the
        // MCP tools all read `leadInDistance` and would otherwise disagree
        // about how long the event actually is. Almost always a no-op - see
        // `EVENT_LEAD_IN_OVERRIDES` for the three routes where Zwift's own
        // figure is wrong and why we only override with published evidence.
        // Applied BEFORE computeTerrain/estimateSurface so the climb/sprint
        // frame decision (`placementsAreRideRelative`) and the geometry
        // reconstruction (`expandOccurrencesForLaps` in `routeOccurrences.ts`,
        // `geometryForRouteLaps`)
        // work from the same lead-in - previously the raw route leaked into
        // terrain classification (issue #126's exploration, "trap 2").
        //
        // Segment hosts beyond zwift-data merge in here too, for the same
        // reason (#273): the Host routes `segmentHostSupplement.ts` adds from
        // the game dictionary, after the package's own (the package wins - an
        // entry it already ships is skipped), and the placements measured by
        // matching tracks (`segmentPlacements.ts`), which only ever cover
        // pairs zwift-data has not placed. Both are in place before
        // computeTerrain reads the climbs and sprints.
        const corrected = {
          ...route,
          ...eventLeadIn(route.slug, route.leadInDistance, route.leadInElevation),
          ...withSegmentHostsBeyondPackage(route)
        }
        return {
          ...corrected,
          worldName: getWorldName(route.world),
          terrain: computeTerrain(corrected),
          surface: estimateSurface(corrected)
        }
      })
  }
  return cachedRoutes
}

function withSegmentHostsBeyondPackage(route: (typeof routes)[number]): Pick<(typeof routes)[number], 'segments' | 'segmentsOnRoute'> {
  const added = SUPPLEMENT_SEGMENT_HOSTS
    .filter(host => host.route === route.slug && !route.segments?.includes(host.segment))
    .map(host => host.segment)
  const placed = getGeneratedSegmentPlacements(route.slug)
  return {
    segments: added.length ? [...route.segments ?? [], ...added] : route.segments,
    segmentsOnRoute: placed.length ? [...route.segmentsOnRoute ?? [], ...placed].sort((a, b) => a.from - b.from) : route.segmentsOnRoute
  }
}

export function getRouteBySlug(slug: string): RouteWithMeta | undefined {
  return getRoutesWithMeta().find(r => r.slug === slug)
}

export function toRouteSummary(route: RouteWithMeta): RouteSummary {
  return {
    id: route.id,
    slug: route.slug,
    name: route.name,
    world: route.world,
    worldName: route.worldName,
    distance: route.distance,
    elevation: route.elevation,
    sports: route.sports,
    eventOnly: route.eventOnly,
    supportsTT: route.supportsTT,
    terrain: route.terrain,
    surface: route.surface
  }
}

export function getWorlds() {
  return worlds
}
