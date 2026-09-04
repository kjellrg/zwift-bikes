import { getRouteBySlug, toRouteSummary } from '../../../shared/utils/catalog'
import { geometryForRouteLaps } from '../../../shared/utils/physics'
import { clampLaps } from '../../../shared/utils/routeLaps'
import { parseQuery, recommendRouteQuerySchema } from '../../utils/apiQuerySchemas'
import { defineCachedRecommendHandler } from '../../utils/recommendCache'
import { draftNotes, runRecommendPipeline } from '../../utils/recommendPipeline'

// Wrapped in the edge cache (see `recommendCache.ts`): everything below is a
// pure function of path + query + the deployed bundle, so a computed response
// is served from the colo's cache until the next deploy.
//
// The ranking itself lives in `server/utils/recommendPipeline.ts`, shared with
// the segment endpoint - what this file owns is the route: how many laps of
// it, the geometry one integration covers, and the wording that describes how
// faithfully its terrain is mapped.
export default defineCachedRecommendHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing route slug' })
  const route = getRouteBySlug(slug)
  if (!route) throw createError({ statusCode: 404, statusMessage: `Route "${slug}" not found` })

  // Every parameter's meaning, default and clamp lives on the schema - see
  // `recommendRouteQuerySchema` and its field comments in
  // `server/utils/apiQuerySchemas.ts`. An invalid value throws a 400 here.
  const q = parseQuery(event, recommendRouteQuerySchema)
  const laps = clampLaps(route, q.laps)

  const result = await runRecommendPipeline(event, q, {
    route,
    laps,
    excludeTT: q.excludeTT,
    // Route distance x laps is what the simulation cost scales with, so it
    // leads the log line's request-shape fields.
    timingMeta: { route: route.slug, distanceKm: Math.round(route.distance * laps * 10) / 10, laps },
    prepare: (simulate, rider) => {
      // Nothing is simulated without a rider profile, or in legacy mode - the
      // only geometry those requests can need is the TTT plan's, and only if
      // a plan is asked for at all.
      if (!rider) return { planGeometry: () => geometryForRouteLaps(route, laps) }
      // One integration covers the whole ride: the lead-in plus every lap.
      // Built once and reused for the plan, which must describe the same
      // coordinates the sims ride.
      const geometry = geometryForRouteLaps(route, laps)
      return {
        planGeometry: () => geometry,
        simulateSec: ({ frame, wheelset, powerSegmentsW, powerScaleAtSpeed }) =>
          simulate({ rider, frame, wheelset, geometry, powerSegmentsW, powerScaleAtSpeed }).elapsedSec
      }
    }
  })

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
