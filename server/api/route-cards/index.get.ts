import { getWorlds } from '../../../shared/utils/catalog'
import type { RelatedRouteCardData, RouteCardData } from '../../../shared/utils/routeCards'
import { parseQuery, routeCardsQuerySchema } from '../../utils/apiQuerySchemas'
import { allRouteCards, relatedRouteCards } from '../../utils/routeCardCatalog'

/**
 * Route cards (#262): every cycling route as a listing draws it, with the
 * worlds in the game's own order for the homepage's world filter - Watopia
 * first, as `/api/segments` gives them - or with `?relatedTo=<slug>` the four
 * a route page suggests next, each marked when it is from another world. The pages that list routes read this instead of
 * `/api/routes`, whose every route carries its full measured profile; that
 * endpoint is unchanged, for the MCP tools, `llms.txt` and anyone else.
 */
export default defineEventHandler((event): { cards: RouteCardData[] | RelatedRouteCardData[], worlds?: ReturnType<typeof getWorlds> } => {
  const { relatedTo } = parseQuery(event, routeCardsQuerySchema)
  if (!relatedTo) return { cards: allRouteCards(), worlds: getWorlds() }
  const cards = relatedRouteCards(relatedTo)
  if (!cards) throw createError({ statusCode: 404, statusMessage: `Route "${relatedTo}" not found` })
  return { cards }
})
