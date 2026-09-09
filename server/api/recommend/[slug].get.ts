import { getRouteBySlug, toRouteSummary } from '../../../shared/utils/catalog'
import { rideForRoute } from '../../../shared/utils/recommendRide'
import { parseQuery, recommendRouteQuerySchema } from '../../utils/apiQuerySchemas'
import { defineCachedRecommendHandler } from '../../utils/recommendCache'
import { draftNotes, runRecommendPipeline } from '../../utils/recommendPipeline'

// Wrapped in the edge cache (see `recommendCache.ts`): everything below is a
// pure function of path + query + the deployed bundle, so a computed response
// is served from the colo's cache until the next deploy.
//
// The ranking itself lives in `server/utils/recommendPipeline.ts`, shared with
// the segment endpoint - what this file owns is the route lookup and the
// wording that describes how faithfully its terrain is mapped.
export default defineCachedRecommendHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing route slug' })
  const route = getRouteBySlug(slug)
  if (!route) throw createError({ statusCode: 404, statusMessage: `Route "${slug}" not found` })

  // Every parameter's meaning, default and clamp lives on the schema - see
  // `recommendRouteQuerySchema` and its field comments in
  // `server/utils/apiQuerySchemas.ts`. An invalid value throws a 400 here.
  const q = parseQuery(event, recommendRouteQuerySchema)
  const result = await runRecommendPipeline(event, q, rideForRoute(route, q.laps, q.excludeTT))

  const { physics } = result
  const { tttNote, raceNote, draftSummary } = draftNotes(physics, 'the race')

  return {
    route: toRouteSummary(route),
    combos: result.combos,
    fastestOverall: result.fastestOverall,
    physics: physics && {
      mode: physics.mode,
      ttt: physics.ttt,
      race: physics.race,
      geometry: route.terrain.elevationProfile
        ? 'measured'
        : route.terrain.climbs.length > 0 ? 'known-climbs-compatibility' : 'aggregate-compatibility',
      rider: physics.rider,
      summary: (route.terrain.elevationProfile
        ? 'Every time below is simulated for your weight, height and power over this route’s real, measured elevation data.'
        : route.terrain.climbs.length > 0
          ? 'Every time below is simulated for your weight, height and power, using real data for this route’s named climbs and an estimate for the rest.'
          : 'Every time below is estimated for your weight, height and power - no elevation data is mapped for this route, so its terrain is approximated.') + draftSummary,
      note: (route.terrain.elevationProfile
        ? 'Dynamic physics is active. Rider height affects aerodynamic drag; this route’s elevation profile is real, measured GPS data (not synthesized), so grade changes are modeled at their actual position along the route.'
        : route.terrain.climbs.length > 0
          ? 'Dynamic physics is active. Rider height affects aerodynamic drag; this route’s named climb(s) use real length/gradient data, with the remaining unmapped distance still synthesized from aggregate elevation.'
          : 'Dynamic physics is active. Rider height affects aerodynamic drag; route geometry is currently synthesized from aggregate distance/elevation - no named climbs are mapped for this route.') + tttNote + raceNote
    },
    pagination: result.pagination
  }
})
