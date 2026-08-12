import { bikeFrames, routes, worlds } from 'zwift-data'
import type { ClassifiedBikeFrame, RouteSummary, RouteWithMeta } from '../types/catalog'
import { classifyBikeFrame } from './classifyBikeFrame'
import { computeTerrain, estimateSurface } from './routeTerrain'

const worldNameBySlug = new Map<string, string>(worlds.map(w => [w.slug, w.name]))
const worldImageUrlBySlug = new Map<string, string>(worlds.map(w => [w.slug, w.imageUrl]))

export function getWorldName(slug: string): string {
  return worldNameBySlug.get(slug) ?? slug
}

export function getWorldImageUrl(slug: string): string | undefined {
  return worldImageUrlBySlug.get(slug)
}

let cachedFrames: ClassifiedBikeFrame[] | undefined
let cachedRoutes: RouteWithMeta[] | undefined

export function getFrames(): ClassifiedBikeFrame[] {
  if (!cachedFrames) cachedFrames = bikeFrames.map(f => classifyBikeFrame(f))
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
      .map(route => ({
        ...route,
        worldName: getWorldName(route.world),
        terrain: computeTerrain(route),
        surface: estimateSurface(route)
      }))
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
