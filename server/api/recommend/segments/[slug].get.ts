import { getSegmentSummary, routeWithMetaForSegment } from '../../../../shared/utils/routeSegments'
import { rideForSegment, WARMUP_DISTANCE_M } from '../../../../shared/utils/recommendRide'
import { parseQuery, recommendSegmentQuerySchema } from '../../../utils/apiQuerySchemas'
import { defineCachedRecommendHandler } from '../../../utils/recommendCache'
import { draftNotes, runRecommendPipeline } from '../../../utils/recommendPipeline'

// Wrapped in the edge cache for the same reason as `recommend/[slug].get.ts`,
// and ranked by the same `server/utils/recommendPipeline.ts`. This file owns
// the segment lookup and the wording that describes how it is ridden.
export default defineCachedRecommendHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing segment slug' })
  const summary = getSegmentSummary(slug)
  if (!summary) throw createError({ statusCode: 404, statusMessage: `Segment "${slug}" not found` })

  // Every parameter's meaning, default and clamp lives on the schema - see
  // `recommendSegmentQuerySchema` and its field comments in
  // `server/utils/apiQuerySchemas.ts`. An invalid value throws a 400 here.
  const q = parseQuery(event, recommendSegmentQuerySchema)
  const segmentRoute = routeWithMetaForSegment(summary)

  const result = await runRecommendPipeline(event, q, rideForSegment(segmentRoute, q.excludeTT))

  const { physics } = result
  const { tttNote, raceNote, draftSummary } = draftNotes(physics, 'the effort')

  return {
    segment: summary,
    combos: result.combos,
    fastestOverall: result.fastestOverall,
    physics: physics && {
      ...physics,
      summary: (physics.mode === 'legacy'
        ? 'Every time below is estimated for your weight, height and power at this segment’s average grade.'
        : 'Every time below is simulated for your weight, height and power, entered at racing speed rather than from a standing start.') + draftSummary,
      note: (physics.mode === 'legacy'
        ? 'Legacy finish-time model active - a constant-speed estimate at this segment’s own average grade.'
        : `Dynamic physics is active. The segment is simulated after a ${WARMUP_DISTANCE_M / 1000}km flat warmup so the timed portion starts at realistic speed, matching how a Zwift/Strava segment is actually entered (never from a standing start).`) + tttNote + raceNote
    },
    pagination: result.pagination
  }
})
