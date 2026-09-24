import { getRouteBySlug, getRoutesWithMeta, toRouteSummary } from '../../shared/utils/catalog'
import { relatedRoutes } from '../../shared/utils/relatedRoutes'
import { toRouteCard, type RelatedRouteCardData, type RouteCardData } from '../../shared/utils/routeCards'
import type { Silhouette } from '../../shared/utils/silhouette'

/**
 * Route cards, built where the catalog lives (#262): every listing that
 * draws a route - the homepage's grid, a route page's related rides, a
 * season's race rows - reads its card from here instead of fetching the
 * full `/api/routes` listing and cutting it down in the page.
 *
 * The catalog only changes on deploy, so the cards are built once per
 * worker instance, on first use, and reused.
 */
let cachedCards: RouteCardData[] | undefined
let cachedBySlug: Map<string, RouteCardData> | undefined

/** Every cycling route as its card, by name - what `/api/route-cards` serves. */
export function allRouteCards(): RouteCardData[] {
  if (!cachedCards) {
    // From the listing's summary, as the homepage always drew them: the lap
    // alone, since a listing describes the route and not an event's lead-in.
    cachedCards = getRoutesWithMeta()
      .filter(route => route.sports.includes('cycling'))
      .map(route => toRouteCard(toRouteSummary(route)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  return cachedCards
}

function cardBySlug(slug: string): RouteCardData | undefined {
  cachedBySlug ??= new Map(allRouteCards().map(card => [card.slug, card]))
  return cachedBySlug.get(slug)
}

/** The four cards a route page suggests next (see `relatedRoutes`); undefined for a route the catalog does not have. */
export function relatedRouteCards(slug: string): RelatedRouteCardData[] | undefined {
  const route = getRouteBySlug(slug)
  if (!route) return undefined
  return relatedRoutes({ ...route, climbRatio: route.terrain.climbRatio }, allRouteCards())
    .map(({ route: card, otherWorld }) => ({ ...card, otherWorld }))
}

/** A route's card Silhouette - one lap, the listing's sample count - for a listing outside the route grid. */
export function routeCardSilhouette(slug: string): Silhouette | undefined {
  return cardBySlug(slug)?.shape
}
