import { getRouteBySlug } from '../../../shared/utils/catalog'
import { parseQuery, recommendRouteQuerySchema } from '../../utils/apiQuerySchemas'
import type { RouteRanking } from '../../utils/rankRide'
import { answerRecommendRequest } from '../../utils/recommendHttp'

// The HTTP adapter for ranking a route Ride. The ranking - its cache, its
// kill switch, its prose and its response type (`RouteRanking`) - lives in
// the Ride ranking module, `server/utils/rankRide.ts`; what this file owns is
// the route lookup and the query it was asked in.
export default defineEventHandler(async (event): Promise<RouteRanking> => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing route slug' })
  const route = getRouteBySlug(slug)
  if (!route) throw createError({ statusCode: 404, statusMessage: `Route "${slug}" not found` })

  // Every parameter's meaning, default and clamp lives on the schema - see
  // `recommendRouteQuerySchema` and its field comments in
  // `server/utils/apiQuerySchemas.ts`. An invalid value throws a 400 here.
  const q = parseQuery(event, recommendRouteQuerySchema)
  return answerRecommendRequest(event, { kind: 'route', route, laps: q.laps, excludeTT: q.excludeTT }, q)
})
