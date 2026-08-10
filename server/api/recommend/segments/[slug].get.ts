import { getFrames } from '../../../../shared/utils/catalog'
import { getSegmentSummary, routeWithMetaForSegment } from '../../../../shared/utils/routeSegments'
import { getWheelsets } from '../../../../shared/utils/wheelsets'
import { capWheelsetsPerFrame, rankCombos } from '../../../../shared/utils/scoring'
import { classifyBikeFrame } from '../../../../shared/utils/classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from '../../../../shared/utils/finishTime'
import { geometryForSegment, geometryForWarmup, prependWarmup, simulateRoute } from '../../../../shared/utils/physics'
import { sliceSurfaceSegments } from '../../../../shared/utils/surfaceGeometry'
import type { BikeCategory } from '../../../../shared/types/catalog'

function parseOwnedLevels(raw: unknown): Record<string, number> {
  if (typeof raw !== 'string' || !raw) return {}
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : {} } catch { return {} }
}
function parseOwnedWheelKeys(raw: unknown): Set<string> {
  if (typeof raw !== 'string' || !raw) return new Set()
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? new Set(parsed) : new Set() } catch { return new Set() }
}

// Flat lead-up distance simulated before the timed segment itself, long
// enough for a rider's speed to converge close to steady-state for their
// power before entering the segment - see `prependWarmup`'s doc comment for
// why a standing-start simulation would badly distort segment rankings.
const WARMUP_DISTANCE_M = 2000

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing segment slug' })
  const summary = getSegmentSummary(slug)
  if (!summary) throw createError({ statusCode: 404, statusMessage: `Segment "${slug}" not found` })

  const query = getQuery(event)
  const preferredRoute = typeof query.route === 'string' && query.route ? query.route : undefined
  const segmentRoute = routeWithMetaForSegment(summary, preferredRoute)

  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : undefined
  const category = typeof query.category === 'string' && query.category ? (query.category as BikeCategory) : undefined
  const limit = query.limit ? Math.min(9, Math.max(1, Number(query.limit))) : 9
  const offset = query.offset ? Math.max(0, Math.floor(Number(query.offset))) : 0
  const verifiedOnly = query.verifiedOnly === 'true'
  const ownedOnly = query.ownedOnly === 'true'
  const ownedLevels = parseOwnedLevels(query.owned)
  const ownedWheelKeys = parseOwnedWheelKeys(query.ownedWheels)
  // See the equivalent comment in `recommend/[slug].get.ts` - fall back to
  // showing everything when the garage doesn't have any of that kind yet.
  const filterFramesByOwnership = ownedOnly && Object.keys(ownedLevels).length > 0
  const filterWheelsetsByOwnership = ownedOnly && ownedWheelKeys.size > 0
  const rawDefaultUnownedLevel = Number(query.defaultUnownedLevel)
  const defaultUnownedLevel = Number.isFinite(rawDefaultUnownedLevel) ? Math.min(5, Math.max(0, rawDefaultUnownedLevel)) : 0
  const weightKg = Number(query.weightKg)
  const heightCm = Number(query.heightCm)
  const wkg = Number(query.wkg)
  const hasRiderProfile = Number.isFinite(weightKg) && weightKg > 0 && Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 220 && Number.isFinite(wkg) && wkg > 0
  const physicsMode = query.physics === 'legacy' || query.physics === 'compare' ? query.physics : 'dynamic'

  let frames = getFrames().filter((frame) => {
    if (category && frame.category !== category) return false
    if (filterFramesByOwnership && !(frame.id.toString() in ownedLevels)) return false
    return true
  }).map((frame) => {
    const ownedLevel = ownedLevels[frame.id.toString()]
    const level = ownedLevel === undefined ? defaultUnownedLevel : ownedLevel
    return level === 0 ? frame : classifyBikeFrame(frame, level)
  })
  let wheelsets = getWheelsets().filter((wheelset) => {
    if (filterWheelsetsByOwnership && !ownedWheelKeys.has(wheelset.key)) return false
    return true
  })
  if (verifiedOnly) {
    frames = frames.filter(f => f.confidence === 'measured')
    wheelsets = wheelsets.filter(w => w.confidence === 'measured')
  }

  // See the equivalent comments in `recommend/[slug].get.ts` - `rankCombos`
  // scores every candidate internally regardless of `limit`, so it's always
  // fetched in full, and once a rider profile is known, pagination/search
  // are driven by the cheap `estimateFinishTimeSec` estimate rather than the
  // abstract `score` (which zeroes aero/climb credit on off-road surfaces,
  // unlike real finish time). Otherwise a genuinely faster combo could rank
  // outside `score`'s view of "the best candidates" and never surface.
  const rankedCombos = rankCombos(segmentRoute, frames, wheelsets, frames.length * wheelsets.length)

  let orderedCombos = rankedCombos
  if (hasRiderProfile) {
    orderedCombos = rankedCombos
      .map(combo => ({ ...combo, finishTimeSec: estimateFinishTimeSec(segmentRoute, combo.frame, combo.wheelset, weightKg, heightCm, wkg, 1) }))
      .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
  }

  // `capWheelsetsPerFrame` must never run before `search` gets to look at
  // the full pool - see its doc comment - so it's skipped entirely while
  // searching, in favor of showing every real match.
  const filteredRankedCombos = search
    ? orderedCombos.filter(c => c.frame.name.toLowerCase().includes(search) || c.wheelset?.name.toLowerCase().includes(search))
    : capWheelsetsPerFrame(orderedCombos, hasRiderProfile ? c => c.finishTimeSec! : c => c.score)
  const pageCombos = filteredRankedCombos.slice(offset, offset + limit)

  if (hasRiderProfile) {
    const segmentGeometry = physicsMode === 'legacy'
      ? undefined
      : geometryForSegment(
          segmentRoute.slug,
          segmentRoute.distance,
          segmentRoute.elevation,
          sliceSurfaceSegments(segmentRoute.surface.segments, 0, segmentRoute.distance, 'tarmac')
        )
    const warmedGeometry = segmentGeometry ? prependWarmup(segmentGeometry, WARMUP_DISTANCE_M) : undefined
    const warmupOnlyGeometry = segmentGeometry ? geometryForWarmup(WARMUP_DISTANCE_M) : undefined

    for (const combo of pageCombos) {
      // Already computed in the full-pool ranking pass above.
      const legacyFinishTimeSec = combo.finishTimeSec!
      combo.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(segmentRoute, combo.frame, combo.wheelset, weightKg, heightCm, wkg, 1)
      if (physicsMode === 'legacy' || !warmedGeometry || !warmupOnlyGeometry) {
        combo.finishTimeSec = legacyFinishTimeSec
      } else {
        const rider = { weightKg, heightCm, powerW: weightKg * wkg }
        const warmupOnly = simulateRoute({ rider, frame: combo.frame, wheelset: combo.wheelset, geometry: warmupOnlyGeometry, dtSec: 0.25 })
        const warmedSegment = simulateRoute({ rider, frame: combo.frame, wheelset: combo.wheelset, geometry: warmedGeometry, dtSec: 0.25 })
        combo.finishTimeSec = warmedSegment.elapsedSec - warmupOnly.elapsedSec
        if (physicsMode === 'compare') (combo as typeof combo & { legacyFinishTimeSec?: number }).legacyFinishTimeSec = legacyFinishTimeSec
      }
    }
    if (physicsMode === 'compare') pageCombos.sort((a, b) => ((a as typeof a & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity) - ((b as typeof b & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity))
    else pageCombos.sort((a, b) => (a.finishTimeSec ?? Infinity) - (b.finishTimeSec ?? Infinity))
  }

  return {
    segment: summary,
    combos: pageCombos,
    physics: hasRiderProfile
      ? {
          mode: physicsMode,
          rider: { weightKg, heightCm, wkg },
          note: physicsMode === 'legacy'
            ? 'Legacy finish-time model active - a constant-speed estimate at this segment’s own average grade.'
            : 'Dynamic physics is active. The segment is simulated after a 2km flat warmup so the timed portion starts at realistic speed, matching how a Zwift/Strava segment is actually entered (never from a standing start).'
        }
      : undefined,
    pagination: {
      offset,
      limit,
      returned: pageCombos.length,
      hasMore: filteredRankedCombos.length > offset + pageCombos.length
    }
  }
})
