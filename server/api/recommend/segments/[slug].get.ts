import { getFrames } from '../../../../shared/utils/catalog'
import { getSegmentSummary, routeWithMetaForSegment } from '../../../../shared/utils/routeSegments'
import { getWheelsets } from '../../../../shared/utils/wheelsets'
import { capWheelsetsPerFrame, rankCombos, searchCombos } from '../../../../shared/utils/scoring'
import { classifyBikeFrame, DEFAULT_UNOWNED_LEVEL, isRedundantCosmeticVariant } from '../../../../shared/utils/classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from '../../../../shared/utils/finishTime'
import { geometryForSegment, geometryForWarmup, orderBySimulatedTime, prependWarmup, simulateRoute, SIMULATED_ORDER_MARGIN } from '../../../../shared/utils/physics'
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
  // Defaults to on - see the equivalent comment in `recommend/[slug].get.ts`.
  const verifiedOnly = query.verifiedOnly !== 'false'
  // See the equivalent comment in `recommend/[slug].get.ts`.
  const rawMaxWheelsets = Number(query.maxWheelsetsPerFrame)
  const maxWheelsetsPerFrame = Number.isFinite(rawMaxWheelsets) ? Math.max(1, Math.round(rawMaxWheelsets)) : undefined
  const ownedOnly = query.ownedOnly === 'true'
  const ownedLevels = parseOwnedLevels(query.owned)
  const ownedWheelKeys = parseOwnedWheelKeys(query.ownedWheels)
  // See the equivalent comment in `recommend/[slug].get.ts` - fall back to
  // showing everything when the garage doesn't have any of that kind yet.
  const filterFramesByOwnership = ownedOnly && Object.keys(ownedLevels).length > 0
  const filterWheelsetsByOwnership = ownedOnly && ownedWheelKeys.size > 0
  const rawDefaultUnownedLevel = Number(query.defaultUnownedLevel)
  // Falls back to the shared constant - see the equivalent comment in
  // `recommend/[slug].get.ts`.
  const defaultUnownedLevel = Number.isFinite(rawDefaultUnownedLevel) ? Math.min(5, Math.max(0, rawDefaultUnownedLevel)) : DEFAULT_UNOWNED_LEVEL
  const weightKg = Number(query.weightKg)
  const heightCm = Number(query.heightCm)
  const wkg = Number(query.wkg)
  const hasRiderProfile = Number.isFinite(weightKg) && weightKg > 0 && Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 220 && Number.isFinite(wkg) && wkg > 0
  const physicsMode = query.physics === 'legacy' || query.physics === 'compare' ? query.physics : 'dynamic'

  // The rider's garage, by frame name - `isRedundantCosmeticVariant` needs to
  // know whether a cosmetic re-skin was explicitly added before it earns a row.
  const ownedFrameNames = new Set(getFrames().filter(f => f.id.toString() in ownedLevels).map(f => f.name))

  let frames = getFrames().filter((frame) => {
    // Never list the same bike twice: a cosmetic re-skin and the frame it
    // re-skins are one bike, so only one of the pair is shown - the re-skin
    // only when it's explicitly in the rider's garage.
    if (isRedundantCosmeticVariant(frame, ownedFrameNames)) return false
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

  const rider = { weightKg, heightCm, powerW: weightKg * wkg }
  const segmentGeometry = hasRiderProfile && physicsMode !== 'legacy'
    ? geometryForSegment(
        segmentRoute.slug,
        segmentRoute.distance,
        segmentRoute.elevation,
        sliceSurfaceSegments(segmentRoute.surface.segments, 0, segmentRoute.distance, 'tarmac')
      )
    : undefined
  const warmedGeometry = segmentGeometry ? prependWarmup(segmentGeometry, WARMUP_DISTANCE_M) : undefined
  const warmupOnlyGeometry = segmentGeometry ? geometryForWarmup(WARMUP_DISTANCE_M) : undefined

  // Both sims must share the same time step for this subtraction to cancel
  // cleanly - they use the simulator's default (see `DEFAULT_DT_SEC`).
  const simulateSegmentSec = (combo: typeof rankedCombos[number]) =>
    simulateRoute({ rider, frame: combo.frame, wheelset: combo.wheelset, geometry: warmedGeometry! }).elapsedSec
    - simulateRoute({ rider, frame: combo.frame, wheelset: combo.wheelset, geometry: warmupOnlyGeometry! }).elapsedSec

  let orderedCombos = rankedCombos
  if (hasRiderProfile) {
    orderedCombos = rankedCombos
      .map(combo => ({ ...combo, finishTimeSec: estimateFinishTimeSec(segmentRoute, combo.frame, combo.wheelset, weightKg, heightCm, wkg, 1) }))
      .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
  }

  // See the equivalent comment in `recommend/[slug].get.ts` - capping is
  // skipped entirely while searching, and matches are ordered frame-name
  // matches first (see `searchCombos`).
  let filteredRankedCombos = search
    ? searchCombos(orderedCombos, search)
    : capWheelsetsPerFrame(orderedCombos, hasRiderProfile ? c => c.finishTimeSec! : c => c.score, maxWheelsetsPerFrame)

  // See the equivalent comment in `recommend/[slug].get.ts` - the reachable
  // window is re-ordered by real simulated time before pagination, because
  // that's the signal this endpoint displays; paginating the cheap estimate's
  // order instead let a combo the simulator ranks higher fall off the page.
  const simulatedSec = new Map<typeof orderedCombos[number], number>()
  if (warmedGeometry && warmupOnlyGeometry && physicsMode === 'dynamic') {
    const ordering = orderBySimulatedTime(filteredRankedCombos, offset + limit + SIMULATED_ORDER_MARGIN, simulateSegmentSec)
    filteredRankedCombos = ordering.ordered
    for (const [combo, seconds] of ordering.simulatedSec) simulatedSec.set(combo, seconds)
  }
  const pageCombos = filteredRankedCombos.slice(offset, offset + limit)

  if (hasRiderProfile) {
    for (const combo of pageCombos) {
      // Already computed in the full-pool ranking pass above.
      const legacyFinishTimeSec = combo.finishTimeSec!
      combo.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(segmentRoute, combo.frame, combo.wheelset, weightKg, heightCm, wkg, 1)
      if (physicsMode === 'legacy' || !warmedGeometry || !warmupOnlyGeometry) {
        combo.finishTimeSec = legacyFinishTimeSec
      } else {
        combo.finishTimeSec = simulatedSec.get(combo) ?? simulateSegmentSec(combo)
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
