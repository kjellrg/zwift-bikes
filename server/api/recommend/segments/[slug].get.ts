import { getFrames } from '../../../../shared/utils/catalog'
import { getSegmentSummary, routeWithMetaForSegment } from '../../../../shared/utils/routeSegments'
import { getWheelsets } from '../../../../shared/utils/wheelsets'
import { capWheelsetsPerFrame, rankCombos, searchCombos } from '../../../../shared/utils/scoring'
import { classifyBikeFrame, isRedundantCosmeticVariant, PURCHASABLE_HALO_FRAMES } from '../../../../shared/utils/classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from '../../../../shared/utils/finishTime'
import { FASTEST_OVERALL_ORDER_MARGIN, geometryForSegment, geometryForWarmup, orderBySimulatedTime, prependWarmup, RACE_DRAFT_SAVING, racePowerScaleAtSpeed, simulateRoute, SIMULATED_ORDER_MARGIN, tttFrontPullPowerW, tttLastWheelPowerW, tttPowerPlan, tttPowerScaleAtSpeed } from '../../../../shared/utils/physics'
import { sliceSurfaceSegments } from '../../../../shared/utils/surfaceGeometry'
import type { BikeCategory } from '../../../../shared/types/catalog'
import { parseQuery, recommendSegmentQuerySchema } from '../../../utils/apiQuerySchemas'
import { defineCachedRecommendHandler } from '../../../utils/recommendCache'
import { addTimingMeta, markPhase } from '../../../utils/timing'

// Flat lead-up distance simulated before the timed segment itself, long
// enough for a rider's speed to converge close to steady-state for their
// power before entering the segment - see `prependWarmup`'s doc comment for
// why a standing-start simulation would badly distort segment rankings.
// The warm-up is ridden at the request's own power - even a 1500 W sprint
// setting. That's deliberate: warm-up-only time is subtracted back out, so
// its sole effect is entering the segment at steady-state speed for that
// power (a flying sprint), applied identically to every combo.
const WARMUP_DISTANCE_M = 2000

// Wrapped in the edge cache for the same reason as `recommend/[slug].get.ts`.
export default defineCachedRecommendHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing segment slug' })
  const summary = getSegmentSummary(slug)
  if (!summary) throw createError({ statusCode: 404, statusMessage: `Segment "${slug}" not found` })

  // Counts integrations, not combos - see the equivalent comment in
  // `recommend/[slug].get.ts`. Note this endpoint runs TWO of them per
  // candidate (warmed, minus warmup-only), so the count here is roughly
  // double the route endpoint's for the same-sized pool.
  let simCount = 0
  const countedSimulate: typeof simulateRoute = (options) => {
    simCount++
    return simulateRoute(options)
  }

  // Every parameter's meaning, default and clamp lives on the schema - see
  // `recommendSegmentQuerySchema` and its field comments in
  // `server/utils/apiQuerySchemas.ts`. An invalid value throws a 400 here.
  const q = parseQuery(event, recommendSegmentQuerySchema)
  const {
    search, category, limit, offset, verifiedOnly, includeHalo,
    maxWheelsetsPerFrame, ownedOnly, owned: ownedLevels, ownedWheels: ownedWheelKeys,
    defaultUnownedLevel, physics: physicsMode, draftMode, tttRiders
  } = q
  const segmentRoute = routeWithMetaForSegment(summary, q.route)

  // See the equivalent comment in `recommend/[slug].get.ts` - fall back to
  // showing everything when the garage doesn't have any of that kind yet.
  const filterFramesByOwnership = ownedOnly && Object.keys(ownedLevels).length > 0
  const filterWheelsetsByOwnership = ownedOnly && ownedWheelKeys.size > 0
  // The schema guarantees the profile arrives complete and in bounds or not
  // at all - see the equivalent comment in `recommend/[slug].get.ts`.
  const hasRiderProfile = q.weightKg !== undefined && q.heightCm !== undefined && q.powerW !== undefined
  const weightKg = q.weightKg ?? 0
  const heightCm = q.heightCm ?? 0
  const powerW = q.powerW ?? 0
  const tttClimbWkg = draftMode === 'ttt' ? q.tttClimbWkg : undefined

  // The rider's garage, by frame name - `isRedundantCosmeticVariant` needs to
  // know whether a cosmetic re-skin was explicitly added before it earns a row.
  const ownedFrameNames = new Set(getFrames().filter(f => f.id.toString() in ownedLevels).map(f => f.name))

  // Purchasable Halo frames the ranked pool should not show - see the
  // equivalent comment in `recommend/[slug].get.ts` for why search and
  // ownership bypass it, and why it must not shrink `allFrames`.
  const isHiddenHalo = (frame: { name: string }) => !includeHalo && !search
    && PURCHASABLE_HALO_FRAMES.has(frame.name) && !ownedFrameNames.has(frame.name)

  // Built WITHOUT the category and Halo filters - see the equivalent comment
  // in `recommend/[slug].get.ts`; every other filter applies to both the
  // ranked results and the `fastestOverall` comparison at the end.
  let allFrames = getFrames().filter((frame) => {
    // Never list the same bike twice: a cosmetic re-skin and the frame it
    // re-skins are one bike, so only one of the pair is shown - the re-skin
    // only when it's explicitly in the rider's garage.
    if (isRedundantCosmeticVariant(frame, ownedFrameNames)) return false
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
    allFrames = allFrames.filter(f => f.confidence === 'measured')
    wheelsets = wheelsets.filter(w => w.confidence === 'measured')
  }
  const rankable = allFrames.filter(f => !isHiddenHalo(f))
  const frames = category ? rankable.filter(f => f.category === category) : rankable
  // Carries this instance's lazy catalog init on a cold start.
  await markPhase(event, 'pool')

  // See the equivalent comments in `recommend/[slug].get.ts` - `rankCombos`
  // scores every candidate internally regardless of `limit`, so it's always
  // fetched in full, and once a rider profile is known, pagination/search
  // are driven by the cheap `estimateFinishTimeSec` estimate rather than the
  // abstract `score` (which zeroes aero/climb credit on off-road surfaces,
  // unlike real finish time). Otherwise a genuinely faster combo could rank
  // outside `score`'s view of "the best candidates" and never surface.
  const rankedCombos = rankCombos(segmentRoute, frames, wheelsets, frames.length * wheelsets.length)
  await markPhase(event, 'rank')

  const rider = { weightKg, heightCm, powerW }
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

  // TTT power plan, built ONCE per request in the segment's own coordinates
  // (legacy mode has no `segmentGeometry`, so build an equivalent throwaway
  // one - cheap, it's a 2-point line), then offset by the warmup distance
  // into warmed coordinates for the sims. The warmup-only sim gets no climb
  // overrides - a flat warmup can never contain a climb block - but it DOES
  // get the same draft scaling, so both runs cross the warmup under identical
  // conditions. (That subtraction is very slightly inexact for a reason that
  // predates draft mode: the steady-state early exit fires in the warmup-only
  // run but not in the warmed one. See the note in the TTT PR.)
  const tttPlan = hasRiderProfile && tttClimbWkg
    ? tttPowerPlan(
        segmentGeometry ?? geometryForSegment(segmentRoute.slug, segmentRoute.distance, segmentRoute.elevation, sliceSurfaceSegments(segmentRoute.surface.segments, 0, segmentRoute.distance, 'tarmac')),
        tttClimbWkg,
        weightKg
      )
    : undefined
  const warmedPowerSegmentsW = tttPlan?.powerSegmentsW.map(segment => ({ ...segment, fromM: segment.fromM + WARMUP_DISTANCE_M, toM: segment.toM + WARMUP_DISTANCE_M }))
  const draftEstimate = draftMode === 'ttt'
    ? { mode: 'ttt' as const, riders: tttRiders, climb: tttPlan ? { distanceM: tttPlan.climbDistanceM, elevationM: tttPlan.climbElevationM, powerW: tttPlan.climbPowerW } : undefined }
    : draftMode === 'race' ? { mode: 'race' as const } : undefined
  // Applied to BOTH the warmed and the warmup-only run, so the group enters
  // the segment at its own drafted steady-state speed and the subtraction
  // still cancels exactly.
  const powerScaleAtSpeed = draftMode === 'ttt'
    ? (speedMps: number) => tttPowerScaleAtSpeed(tttRiders, speedMps)
    : draftMode === 'race' ? (speedMps: number) => racePowerScaleAtSpeed(speedMps) : undefined

  // Both sims must share the same time step for this subtraction to cancel
  // cleanly - they use the simulator's default (see `DEFAULT_DT_SEC`).
  const simulateSegmentSec = (combo: typeof rankedCombos[number]) =>
    countedSimulate({ rider, frame: combo.frame, wheelset: combo.wheelset, geometry: warmedGeometry!, powerSegmentsW: warmedPowerSegmentsW, powerScaleAtSpeed }).elapsedSec
    - countedSimulate({ rider, frame: combo.frame, wheelset: combo.wheelset, geometry: warmupOnlyGeometry!, powerScaleAtSpeed }).elapsedSec
  await markPhase(event, 'geometry')

  let orderedCombos = rankedCombos
  if (hasRiderProfile) {
    orderedCombos = rankedCombos
      .map(combo => ({ ...combo, finishTimeSec: estimateFinishTimeSec(segmentRoute, combo.frame, combo.wheelset, weightKg, heightCm, powerW, 1, draftEstimate) }))
      .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
  }
  await markPhase(event, 'estimate')

  // See the equivalent comment in `recommend/[slug].get.ts` - capping is
  // skipped entirely while searching, and matches are ordered frame-name
  // matches first (see `searchCombos`).
  let filteredRankedCombos = search
    ? searchCombos(orderedCombos, search)
    : capWheelsetsPerFrame(orderedCombos, hasRiderProfile ? c => c.finishTimeSec! : c => c.score, maxWheelsetsPerFrame)
  await markPhase(event, 'filter')

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
  await markPhase(event, 'simulate')

  const pageCombos = filteredRankedCombos.slice(offset, offset + limit)

  if (hasRiderProfile) {
    for (const combo of pageCombos) {
      // Already computed in the full-pool ranking pass above.
      const legacyFinishTimeSec = combo.finishTimeSec!
      combo.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(segmentRoute, combo.frame, combo.wheelset, weightKg, heightCm, powerW, 1)
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
  await markPhase(event, 'page')

  // "TTT saves X vs solo" - the same rider at the same power and pacing, with
  // the draft scaling removed from both halves of the subtraction, so the
  // gap isolates the draft itself. See `recommend/[slug].get.ts`.
  let ttt: { riders: number, riderPowerW: number, frontPullPowerW: number, lastWheelPowerW: number, climbWkg?: number, soloFinishTimeSec?: number, tttSavedSec?: number } | undefined
  if (hasRiderProfile && draftMode === 'ttt') {
    const topCombo = pageCombos[0]
    let soloFinishTimeSec: number | undefined
    let tttSavedSec: number | undefined
    if (warmedGeometry && warmupOnlyGeometry && physicsMode === 'dynamic' && offset === 0 && topCombo && typeof topCombo.finishTimeSec === 'number') {
      soloFinishTimeSec = countedSimulate({ rider, frame: topCombo.frame, wheelset: topCombo.wheelset, geometry: warmedGeometry, powerSegmentsW: warmedPowerSegmentsW }).elapsedSec
        - countedSimulate({ rider, frame: topCombo.frame, wheelset: topCombo.wheelset, geometry: warmupOnlyGeometry }).elapsedSec
      tttSavedSec = soloFinishTimeSec - topCombo.finishTimeSec
    }
    ttt = {
      riders: tttRiders,
      riderPowerW: Math.round(rider.powerW),
      frontPullPowerW: Math.round(tttFrontPullPowerW(rider.powerW, tttRiders)),
      lastWheelPowerW: Math.round(tttLastWheelPowerW(rider.powerW, tttRiders)),
      climbWkg: tttClimbWkg,
      soloFinishTimeSec,
      tttSavedSec
    }
  }
  // "Sitting in the bunch saves X vs solo" - the same warmed-minus-warmup
  // subtraction as the ranked times, run once with the race power scale removed
  // from both halves. Race mode has no pacing plan, so nothing but the draft
  // differs between the two rides.
  let race: { savingPct: number, riderPowerW: number, soloFinishTimeSec?: number, raceSavedSec?: number } | undefined
  if (hasRiderProfile && draftMode === 'race') {
    const topCombo = pageCombos[0]
    let soloFinishTimeSec: number | undefined
    let raceSavedSec: number | undefined
    if (warmedGeometry && warmupOnlyGeometry && physicsMode === 'dynamic' && offset === 0 && topCombo && typeof topCombo.finishTimeSec === 'number') {
      soloFinishTimeSec = countedSimulate({ rider, frame: topCombo.frame, wheelset: topCombo.wheelset, geometry: warmedGeometry }).elapsedSec
        - countedSimulate({ rider, frame: topCombo.frame, wheelset: topCombo.wheelset, geometry: warmupOnlyGeometry }).elapsedSec
      raceSavedSec = soloFinishTimeSec - topCombo.finishTimeSec
    }
    race = {
      savingPct: Math.round(RACE_DRAFT_SAVING * 100),
      riderPowerW: Math.round(rider.powerW),
      soloFinishTimeSec,
      raceSavedSec
    }
  }
  // "A bike your filters are hiding is faster" - see the equivalent block in
  // `recommend/[slug].get.ts` for why this is computed server-side, why only
  // the frames the ranked pool can't show (out-of-category or Halo-hidden)
  // are ranked, what `reason` is for, and why it is gated this narrowly.
  let fastestOverall: { frameId: number, frameName: string, category: BikeCategory, reason: 'category' | 'halo', wheelsetName?: string, finishTimeSec: number, deltaSec: number } | undefined
  const pageTopCombo = pageCombos[0]
  if ((category || !includeHalo) && hasRiderProfile && offset === 0 && !search && pageTopCombo && typeof pageTopCombo.finishTimeSec === 'number') {
    const hiddenFrames = allFrames.filter(f => (category && f.category !== category) || isHiddenHalo(f))
    if (hiddenFrames.length) {
      let candidates = rankCombos(segmentRoute, hiddenFrames, wheelsets, hiddenFrames.length * wheelsets.length)
        .map(combo => ({ ...combo, finishTimeSec: estimateFinishTimeSec(segmentRoute, combo.frame, combo.wheelset, weightKg, heightCm, powerW, 1, draftEstimate) }))
        .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
      let overallTopSec = candidates[0]?.finishTimeSec
      if (warmedGeometry && warmupOnlyGeometry && physicsMode === 'dynamic') {
        // `simulateSegmentSec` is the same warmed-minus-warmup subtraction the
        // ranked results use, so this time is directly comparable to theirs.
        const ordering = orderBySimulatedTime(candidates, 1 + FASTEST_OVERALL_ORDER_MARGIN, simulateSegmentSec)
        candidates = ordering.ordered
        overallTopSec = candidates[0] ? ordering.simulatedSec.get(candidates[0]) : undefined
      }
      const overallTop = candidates[0]
      if (overallTop && typeof overallTopSec === 'number' && overallTopSec < pageTopCombo.finishTimeSec) {
        fastestOverall = {
          frameId: overallTop.frame.id,
          frameName: overallTop.frame.name,
          category: overallTop.frame.category,
          // Both-out-of-category-and-Halo reports `halo` - see the
          // equivalent comment in `recommend/[slug].get.ts`.
          reason: isHiddenHalo(overallTop.frame) ? 'halo' as const : 'category' as const,
          wheelsetName: overallTop.wheelset?.name,
          finishTimeSec: overallTopSec,
          deltaSec: pageTopCombo.finishTimeSec - overallTopSec
        }
      }
    }
  }

  await markPhase(event, 'extras')
  addTimingMeta(event, {
    segment: summary.slug,
    route: segmentRoute.slug,
    distanceKm: Math.round(segmentRoute.distance * 10) / 10,
    physics: physicsMode,
    draft: draftMode,
    category,
    profile: hasRiderProfile,
    combos: rankedCombos.length,
    sims: simCount,
    offset,
    searching: Boolean(search)
  })

  const tttNote = ttt
    ? ` TTT draft mode: your ${ttt.riderPowerW} W is your OWN average across a full rotation of ${ttt.riders} riders - you hold about ${ttt.frontPullPowerW} W while pulling on the front and sit around ${ttt.lastWheelPowerW} W in the last wheel, so the group covers ground like a solo rider at ~${ttt.frontPullPowerW} W on the flat. The benefit fades as the group slows on climbs and grows on descents${ttt.climbWkg !== undefined ? `; long climbs (3%+ for 3.5+ min) are paced at your team's ${ttt.climbWkg.toFixed(1)} W/kg` : ''}.`
    : ''

  const raceNote = race
    ? ` Race draft mode: assumes you sit in a typical mass-start bunch. Your ${race.riderPowerW} W is still your OWN average for the effort (average power, not normalised), and the predicted time includes the ~${race.savingPct}% power equivalent a mid-pack racer measurably gets - field-calibrated across thirteen real races, where a typical bunch spreads roughly ±3-4 percentage points, i.e. ±1-2% on finish time. This is a typical mid-pack outcome, not a win or a breakaway. The benefit fades on climbs and grows on descents automatically.`
    : ''

  // See the equivalent comment in `recommend/[slug].get.ts`: a one-sentence
  // lead for the pages, with `note` kept intact behind their disclosure and
  // for the MCP tools.
  const draftSummary = ttt
    ? ` Ridden as a ${ttt.riders}-rider paceline, at your own average power across the rotation.`
    : race
      ? ' Ridden in a typical mass-start bunch, at your own average power.'
      : ''

  return {
    segment: summary,
    combos: pageCombos,
    fastestOverall,
    physics: hasRiderProfile
      ? {
          mode: physicsMode,
          ttt,
          race,
          rider: { weightKg, heightCm, powerW: Math.round(powerW) },
          summary: (physicsMode === 'legacy'
            ? 'Every time below is estimated for your weight, height and power at this segment’s average grade.'
            : 'Every time below is simulated for your weight, height and power, entered at racing speed rather than from a standing start.') + draftSummary,
          note: (physicsMode === 'legacy'
            ? 'Legacy finish-time model active - a constant-speed estimate at this segment’s own average grade.'
            : 'Dynamic physics is active. The segment is simulated after a 2km flat warmup so the timed portion starts at realistic speed, matching how a Zwift/Strava segment is actually entered (never from a standing start).') + tttNote + raceNote
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
