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

/**
 * Pixel dimensions of each world's MiniMap image, keyed by world slug, for
 * og:image:width/height meta tags. Social scrapers process a newly seen
 * image asynchronously and only render a card on the very first share when
 * the dimensions are declared in the tags (Facebook's sharing debugger
 * says exactly this), so every og:image we emit carries them.
 *
 * Maintained by hand because the images live on Zwift's CDN, sized however
 * Zwift exported them (note New York's 1:3 portrait). Regenerate when
 * zwift-data changes an imageUrl:
 *
 *   node -e "const{worlds}=require('zwift-data');worlds.forEach(w=>console.log(w.slug,w.imageUrl))" \
 *     | while read -r slug url; do echo "$slug $(curl -sL "$url" | magick identify -format '%wx%h' -)"; done
 */
const worldImageDimensionsBySlug: Record<string, { width: number, height: number }> = {
  'watopia': { width: 8192, height: 6144 },
  'richmond': { width: 4096, height: 4096 },
  'london': { width: 4096, height: 4096 },
  'new-york': { width: 4096, height: 12288 },
  'innsbruck': { width: 4096, height: 4096 },
  'bologna': { width: 4096, height: 4096 },
  'yorkshire': { width: 4096, height: 4096 },
  'crit-city': { width: 2048, height: 2048 },
  'makuri-islands': { width: 6144, height: 6144 },
  'france': { width: 6144, height: 6144 },
  'paris': { width: 4096, height: 4096 },
  'scotland': { width: 4096, height: 4096 }
}

/**
 * The world's MiniMap image plus its dimensions, shaped for `useSeoMeta`'s
 * og:image object form. Dimensions are omitted (not guessed) for a world
 * missing from the table above, so a new world degrades to a dimensionless
 * og:image rather than a mislabelled one.
 */
export function getWorldImage(slug: string): { url: string, width?: number, height?: number } | undefined {
  const url = worldImageUrlBySlug.get(slug)
  if (!url) return undefined
  return { url, ...worldImageDimensionsBySlug[slug] }
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
