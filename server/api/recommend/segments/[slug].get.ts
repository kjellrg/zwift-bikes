import { getSegmentSummary, routeWithMetaForSegment } from '../../../../shared/utils/routeSegments'
import { geometryForSegment, geometryForWarmup, prependWarmup } from '../../../../shared/utils/physics'
import { sliceSurfaceSegments } from '../../../../shared/utils/surfaceGeometry'
import { parseQuery, recommendSegmentQuerySchema } from '../../../utils/apiQuerySchemas'
import { defineCachedRecommendHandler } from '../../../utils/recommendCache'
import { draftNotes, runRecommendPipeline } from '../../../utils/recommendPipeline'

// Flat lead-up distance simulated before the timed segment itself, long
// enough for a rider's speed to converge close to steady-state for their
// power before entering the segment - see `prependWarmup`'s doc comment for
// why a standing-start simulation would badly distort segment rankings.
// The warm-up is ridden at the request's own power - even a 1500 W sprint
// setting. That's deliberate: warm-up-only time is subtracted back out, so
// its sole effect is entering the segment at steady-state speed for that
// power (a flying sprint), applied identically to every combo.
const WARMUP_DISTANCE_M = 2000

// Wrapped in the edge cache for the same reason as `recommend/[slug].get.ts`,
// and ranked by the same `server/utils/recommendPipeline.ts`. What this file
// owns is how a segment is ridden: one lap of a slice of its best-instrumented
// host route, entered at racing speed off a flat warm-up.
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

  const result = await runRecommendPipeline(event, q, {
    route: segmentRoute,
    // A segment is ridden exactly once - there is no lap parameter to clamp.
    laps: 1,
    // No `excludeTT` parameter: a segment ranking is not a race entry, so TT
    // frames are always legal here.
    excludeTT: false,
    timingMeta: { segment: summary.slug, route: segmentRoute.slug, distanceKm: Math.round(segmentRoute.distance * 10) / 10 },
    prepare: (simulate, rider) => {
      const surfaceSegments = sliceSurfaceSegments(segmentRoute.surface.segments, 0, segmentRoute.distance, 'tarmac')
      // Legacy mode has no simulator geometry but a TTT plan still needs one
      // for the estimate's two-phase split, so build an equivalent throwaway -
      // cheap, it's a 2-point line. Note it is built WITHOUT the measured
      // elevation profile the simulating branch below passes: a pre-existing
      // asymmetry, left exactly as it was when this pipeline was extracted.
      if (!rider) {
        return {
          planGeometry: () => geometryForSegment(segmentRoute.slug, segmentRoute.distance, segmentRoute.elevation, surfaceSegments)
        }
      }
      // The measured elevation slice rides along when the host route has one
      // (see `routeWithMetaForSegment`) - the sim then follows the segment's
      // real grade changes instead of one average-grade line. The client's
      // `hasLongClimb` check on the segment page builds this same geometry from
      // the same profile; the two must stay in step or the climb-pace slider's
      // visibility diverges from what the sim actually rides.
      const segmentGeometry = geometryForSegment(
        segmentRoute.slug,
        segmentRoute.distance,
        segmentRoute.elevation,
        surfaceSegments,
        segmentRoute.terrain.elevationProfile
      )
      const warmedGeometry = prependWarmup(segmentGeometry, WARMUP_DISTANCE_M)
      const warmupOnlyGeometry = geometryForWarmup(WARMUP_DISTANCE_M)
      return {
        planGeometry: () => segmentGeometry,
        // TWO integrations per candidate - the warmed run minus the warm-up
        // alone - so this endpoint's `sims` count runs roughly double the
        // route endpoint's for the same-sized pool. Both must share the same
        // time step for the subtraction to cancel cleanly; they use the
        // simulator's default (see `DEFAULT_DT_SEC`).
        //
        // The pacing plan arrives in the segment's own coordinates and is
        // offset into the warmed ones here. The warm-up-only run gets no
        // climb overrides - a flat warm-up can never contain a climb block -
        // but it DOES get the same draft scaling, so both runs cross the
        // warm-up under identical conditions and the subtraction still
        // cancels. (It is very slightly inexact for a reason that predates
        // draft mode: the steady-state early exit fires in the warm-up-only
        // run but not in the warmed one. See the note in the TTT PR.)
        simulateSec: ({ frame, wheelset, powerSegmentsW, powerScaleAtSpeed }) =>
          simulate({
            rider,
            frame,
            wheelset,
            geometry: warmedGeometry,
            powerSegmentsW: powerSegmentsW?.map(segment => ({ ...segment, fromM: segment.fromM + WARMUP_DISTANCE_M, toM: segment.toM + WARMUP_DISTANCE_M })),
            powerScaleAtSpeed
          }).elapsedSec
          - simulate({ rider, frame, wheelset, geometry: warmupOnlyGeometry, powerScaleAtSpeed }).elapsedSec
      }
    }
  })

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
        : 'Dynamic physics is active. The segment is simulated after a 2km flat warmup so the timed portion starts at realistic speed, matching how a Zwift/Strava segment is actually entered (never from a standing start).') + tttNote + raceNote
    },
    pagination: result.pagination
  }
})
