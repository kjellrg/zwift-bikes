import type { H3Event } from 'h3'
import type { RecommendBaseQuery } from './apiQuerySchemas'
import type { RankingFor, RideToRank } from './rankRide'
import { rankingRequestFromQuery, rankRide } from './rankRide'
import { getSiteFlags, KILL_SWITCH_RETRY_AFTER_SEC } from './siteFlags'

/**
 * The HTTP half of the recommend endpoints, shared by the route and the
 * segment endpoint so the two cannot drift apart on it: the parsed query
 * becomes the Ride ranking module's input, and the module's outcome becomes a
 * response.
 *
 * - **answer** is the body, with `X-Recommend-Cache: hit|miss` wherever
 *   there was a cache to ask.
 * - **stall** is a 422 the pages already surface through their refetch
 *   notice: a rider who cannot hold the grade is a fact about the request,
 *   not a server fault.
 * - **paused** is the same 503 + `Retry-After` the site-flags gate answers
 *   with. The gate normally gets there first; this is what answers when it
 *   cannot see the flags.
 *
 * The flags are read on the request itself (`getSiteFlags`), so the module's
 * kill-switch check sees exactly what the gate saw.
 */
export async function answerRecommendRequest<R extends RideToRank>(
  event: H3Event,
  ride: R,
  query: RecommendBaseQuery
): Promise<RankingFor<R>> {
  const { killSwitches } = await getSiteFlags(event)
  const outcome = await rankRide({ ride, ...rankingRequestFromQuery(query), killSwitches, event })

  switch (outcome.status) {
    case 'paused':
      setResponseHeader(event, 'Retry-After', KILL_SWITCH_RETRY_AFTER_SEC)
      throw createError({ statusCode: 503, statusMessage: 'Service Unavailable', message: outcome.message })
    case 'stall':
      throw createError({ statusCode: 422, statusMessage: 'Rider cannot finish this route at this power', message: outcome.message })
    case 'answer':
      if (outcome.cache !== 'off') setResponseHeader(event, 'X-Recommend-Cache', outcome.cache)
      return outcome.ranking
  }
}
