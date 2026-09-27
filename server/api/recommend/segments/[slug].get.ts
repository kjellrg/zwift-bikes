import { getSegmentSummary } from '../../../../shared/utils/routeSegments'
import { parseQuery, recommendSegmentQuerySchema } from '../../../utils/apiQuerySchemas'
import type { SegmentRanking } from '../../../utils/rankRide'
import { answerRecommendRequest } from '../../../utils/recommendHttp'

// The HTTP adapter for ranking a segment Ride, the twin of
// `recommend/[slug].get.ts`: the ranking and its response type
// (`SegmentRanking`) live in `server/utils/rankRide.ts`, and this file owns
// the segment lookup and the query it was asked in.
export default defineEventHandler(async (event): Promise<SegmentRanking> => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing segment slug' })
  const segment = getSegmentSummary(slug)
  if (!segment) throw createError({ statusCode: 404, statusMessage: `Segment "${slug}" not found` })

  // Every parameter's meaning, default and clamp lives on the schema - see
  // `recommendSegmentQuerySchema` and its field comments in
  // `server/utils/apiQuerySchemas.ts`. An invalid value throws a 400 here.
  const q = parseQuery(event, recommendSegmentQuerySchema)
  return answerRecommendRequest(event, { kind: 'segment', segment, excludeTT: q.excludeTT }, q)
})
