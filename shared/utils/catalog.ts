import { bikeFrames, routes, worlds } from 'zwift-data'
import type { ClassifiedBikeFrame, RouteSummary, RouteWithMeta } from '../types/catalog'
import { classifyBikeFrame } from './classifyBikeFrame'
import { eventLeadIn } from '../data/routeEventLeadIns'
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
 * something the repo cannot fix.
 */
export const UNLOCALIZED_FRAME_NAME = /\bLOC_[A-Z0-9_]+_NAME\b/

let cachedFrames: ClassifiedBikeFrame[] | undefined
let cachedRoutes: RouteWithMeta[] | undefined

export function getFrames(): ClassifiedBikeFrame[] {
  if (!cachedFrames) cachedFrames = bikeFrames.filter(f => !UNLOCALIZED_FRAME_NAME.test(f.name)).map(f => classifyBikeFrame(f))
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
        const corrected = { ...route, ...eventLeadIn(route.slug, route.leadInDistance, route.leadInElevation) }
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
