import { getFrames, getRouteBySlug, toRouteSummary } from '../../../shared/utils/catalog'
import { getWheelsets } from '../../../shared/utils/wheelsets'
import { capWheelsetsPerFrame, rankCombos, searchCombos } from '../../../shared/utils/scoring'
import { classifyBikeFrame, DEFAULT_UNOWNED_LEVEL, isRedundantCosmeticVariant } from '../../../shared/utils/classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from '../../../shared/utils/finishTime'
import { clampTttClimbWkg, clampTttRiders, FASTEST_OVERALL_ORDER_MARGIN, geometryForRouteLaps, orderBySimulatedTime, RACE_DRAFT_SAVING, racePowerScaleAtSpeed, simulateRoute, SIMULATED_ORDER_MARGIN, tttFrontPullPowerW, tttLastWheelPowerW, tttPowerPlan, tttPowerScaleAtSpeed } from '../../../shared/utils/physics'
import { clampLaps } from '../../../shared/utils/routeLaps'
import type { BikeCategory } from '../../../shared/types/catalog'
import { addTimingMeta, markPhase } from '../../utils/timing'

function parseOwnedLevels(raw: unknown): Record<string, number> {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}
function parseOwnedWheelKeys(raw: unknown): Set<string> {
  if (typeof raw !== 'string' || !raw) return new Set()
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed) : new Set()
  } catch { return new Set() }
}
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing route slug' })
  const route = getRouteBySlug(slug)
  if (!route) throw createError({ statusCode: 404, statusMessage: `Route "${slug}" not found` })

  // One full route integration is the unit of work this endpoint's latency is
  // made of, so the count goes out with the timing (see server/utils/timing.ts):
  // the `simulate` phase says how long, this says how many, and the two
  // together say whether a slow response was a long route or a deep candidate
  // pool. It moves with `SIMULATED_ORDER_MARGIN` and the disclosure blocks
  // below, not with the page size, which is exactly the thing that is easy to
  // change without noticing.
  let simCount = 0
  const countedSimulate: typeof simulateRoute = (options) => {
    simCount++
    return simulateRoute(options)
  }

  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : undefined
  const category = typeof query.category === 'string' && query.category ? (query.category as BikeCategory) : undefined
  const limit = query.limit ? Math.min(9, Math.max(1, Number(query.limit))) : 9
  const offset = query.offset ? Math.max(0, Math.floor(Number(query.offset))) : 0
  // Defaults to on: an `estimated` score is a name/style heuristic, and a
  // finish time built on one is a much weaker claim than one built on real
  // bot-test data. Callers opt out with `verifiedOnly=false` - which the
  // rider-facing pages send explicitly, so this default and
  // `usePreferences`'s can't drift apart unnoticed. Note it removes the
  // gravel and fun categories entirely, since neither has any measured frame.
  const verifiedOnly = query.verifiedOnly !== 'false'
  // Event race pages send this when the race format outlaws TT frames (Zwift
  // disables them for points and scratch races - see `ttBikesAllowed` in
  // `shared/utils/events.ts`). It's a LEGALITY filter like ownership, not a
  // display trim, and `category` can't express it: a points race allows road
  // AND gravel frames, just never TT. So it must run in the stage-1
  // `allFrames` filter below, before anything selects from the pool - that
  // same pool also feeds the `fastestOverall` disclosure, which would
  // otherwise advertise a TT bike that's illegal in the race.
  const excludeTT = query.excludeTT === 'true'
  // How many wheelsets a single frame may occupy in the results. Undefined
  // keeps `capWheelsetsPerFrame`'s own default; a client that wants one row
  // per frame (the fastest wheelset for this route) passes 1. Only ever
  // narrows what is *displayed* - it is applied after ranking, never before,
  // so it can't remove a candidate from consideration.
  const rawMaxWheelsets = Number(query.maxWheelsetsPerFrame)
  const maxWheelsetsPerFrame = Number.isFinite(rawMaxWheelsets) ? Math.max(1, Math.round(rawMaxWheelsets)) : undefined
  const ownedOnly = query.ownedOnly === 'true'
  const ownedLevels = parseOwnedLevels(query.owned)
  const ownedWheelKeys = parseOwnedWheelKeys(query.ownedWheels)
  // "Only show my garage items" only makes sense once the rider has actually
  // added something of that kind - with no bikes (or no wheels) in the
  // garage yet, fall back to showing all of them instead of filtering down
  // to zero results.
  const filterFramesByOwnership = ownedOnly && Object.keys(ownedLevels).length > 0
  const filterWheelsetsByOwnership = ownedOnly && ownedWheelKeys.size > 0
  const rawDefaultUnownedLevel = Number(query.defaultUnownedLevel)
  // Falls back to the shared constant rather than a local 0, so an
  // unspecified call assumes the same stage the site does - see
  // `DEFAULT_UNOWNED_LEVEL`. The stage changes the ranking, not just the
  // times, so two surfaces disagreeing here recommend different bikes.
  const defaultUnownedLevel = Number.isFinite(rawDefaultUnownedLevel) ? Math.min(5, Math.max(0, rawDefaultUnownedLevel)) : DEFAULT_UNOWNED_LEVEL
  const weightKg = Number(query.weightKg)
  const heightCm = Number(query.heightCm)
  const wkg = Number(query.wkg)
  const hasRiderProfile = Number.isFinite(weightKg) && weightKg > 0 && Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 220 && Number.isFinite(wkg) && wkg > 0
  const laps = clampLaps(route, Number(query.laps))
  const physicsMode = query.physics === 'legacy' || query.physics === 'compare' ? query.physics : 'dynamic'
  // Draft mode (see `physics/draft.ts`). In `ttt` the rider's `wkg` is their own
  // average over the rotation, and the paceline moves at the speed that
  // combined effort produces - roughly a solo rider at 1.38x their power on
  // the flat for an 8-rider team. In `race` the `wkg` is their own race average
  // and a single field-calibrated saving applies; `race` reads NO further query
  // params, which is the whole point of one constant - so its cache key is just
  // `draftMode=race`, and `tttRiders`/`tttClimbWkg` stay TTT-only.
  const draftMode = query.draftMode === 'ttt' ? 'ttt' : query.draftMode === 'race' ? 'race' : 'solo'
  const tttRiders = clampTttRiders(Number(query.tttRiders))
  const tttClimbWkg = draftMode === 'ttt' ? clampTttClimbWkg(Number(query.tttClimbWkg)) : undefined

  // The rider's garage, by frame name - `isRedundantCosmeticVariant` needs to
  // know whether a cosmetic re-skin was explicitly added before it earns a row.
  const ownedFrameNames = new Set(getFrames().filter(f => f.id.toString() in ownedLevels).map(f => f.name))

  // Built WITHOUT the category filter, which is applied separately below.
  // Every other filter - cosmetic dedupe, ownership, verified - belongs to
  // both the ranked results and the `fastestOverall` comparison at the end,
  // so the two can only ever differ by the category itself.
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
  if (excludeTT) allFrames = allFrames.filter(f => f.category !== 'tt')
  const frames = category ? allFrames.filter(f => f.category === category) : allFrames
  // Includes this instance's lazy catalog init on a cold start - frame
  // classification and the route surface data both load on first touch.
  markPhase(event, 'pool')

  // `rankCombos` scores every frame x wheelset pair internally regardless of
  // the `limit` passed in - it only truncates the *returned* array at the
  // end - so there's no computational reason to restrict it up front. Always
  // fetch the full candidate pool so both the search filter below and the
  // ranking step that follows see every candidate, not an arbitrary slice.
  const rankedCombos = rankCombos(route, frames, wheelsets, frames.length * wheelsets.length)
  markPhase(event, 'rank')

  // Once we know the rider's weight/power, `estimateFinishTimeSec` (cheap -
  // a ~40-iteration bisection, no per-meter simulation) is a far more
  // faithful ranking signal than `rankCombos`'s abstract 0-100 `score`.
  // `score` deliberately zeroes out aero/climb credit in proportion to a
  // route's off-road percentage, modeling the real Zwift fact that rolling
  // resistance on cobbles/gravel is purely a wheel-Crr-class effect (see
  // `scoring.ts`'s `OFFROAD_FRAME_WEIGHT` comment). But `estimateFinishTimeSec`
  // correctly keeps rewarding a low-CdA/light combo's aero and climb
  // advantage on those same routes, since aero drag and gravity don't stop
  // applying just because the surface is rough - Crr is an ADDITIONAL
  // resistance term, not a replacement for them. That mismatch let a combo
  // that's genuinely faster (by the same physics `estimateFinishTimeSec`
  // itself uses) rank outside `score`'s idea of "the best candidates" and
  // never get a finish time computed at all - hiding it from both the
  // results list and `search`, e.g. an aero/climb-strong road frame losing
  // to a merely score-tied one on a heavily cobbled route. Re-ranking the
  // FULL pool by the cheap estimate up front - before search/pagination -
  // fixes that at the source instead of only patching what a page happens
  // to already contain.
  const rider = { weightKg, heightCm, powerW: weightKg * wkg }
  const geometry = hasRiderProfile && physicsMode !== 'legacy' ? geometryForRouteLaps(route, laps) : undefined
  // Computed ONCE per request and shared by every combo - a per-combo plan
  // would poison `orderBySimulatedTime`'s physics-keyed dedupe cache (see
  // `physics/draft.ts`). Legacy mode has no geometry but still needs the plan
  // for the estimate's two-phase split, so build one just for it (geometry
  // construction is cheap; simulation is the expensive part).
  const tttPlan = hasRiderProfile && tttClimbWkg
    ? tttPowerPlan(geometry ?? geometryForRouteLaps(route, laps), tttClimbWkg, weightKg)
    : undefined
  // The one object every draft-aware call site threads through: the draft
  // scaling for the simulator, and its closed-form twin for the estimate.
  const draftEstimate = draftMode === 'ttt'
    ? { mode: 'ttt' as const, riders: tttRiders, climb: tttPlan ? { distanceM: tttPlan.climbDistanceM, elevationM: tttPlan.climbElevationM, powerW: tttPlan.climbPowerW } : undefined }
    : draftMode === 'race' ? { mode: 'race' as const } : undefined
  const powerScaleAtSpeed = draftMode === 'ttt'
    ? (speedMps: number) => tttPowerScaleAtSpeed(tttRiders, speedMps)
    : draftMode === 'race' ? (speedMps: number) => racePowerScaleAtSpeed(speedMps) : undefined
  markPhase(event, 'geometry')

  let orderedCombos = rankedCombos
  if (hasRiderProfile) {
    orderedCombos = rankedCombos
      .map(combo => ({ ...combo, finishTimeSec: estimateFinishTimeSec(route, combo.frame, combo.wheelset, weightKg, heightCm, wkg, laps, draftEstimate) }))
      .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
  }
  markPhase(event, 'estimate')

  // `capWheelsetsPerFrame` must never run before `search` gets to look at
  // the full pool - see its doc comment - so it's skipped entirely while
  // searching, in favor of showing every real match, ordered frame-name
  // matches first (see `searchCombos`).
  let filteredRankedCombos = search
    ? searchCombos(orderedCombos, search)
    : capWheelsetsPerFrame(orderedCombos, hasRiderProfile ? c => c.finishTimeSec! : c => c.score, maxWheelsetsPerFrame)
  markPhase(event, 'filter')

  // The cheap estimate got the pool into roughly the right order, but it is
  // NOT the signal this endpoint displays: in `dynamic` mode every time a
  // rider sees comes from `simulateRoute`, and the two models disagree about
  // more than a constant offset (see `orderBySimulatedTime`). Paginating the
  // estimate's order while displaying simulated times let a combo the
  // simulator ranks 2nd sit on page two, turning up under "Show more matches"
  // faster than bikes listed above it. So the window a rider can actually
  // reach is re-ordered by real simulated time before it is paginated - and
  // the page's own simulations come out of that same pass. `compare` mode
  // keeps the estimate's ordering, since showing where the two models differ
  // is its whole purpose.
  const simulatedSec = new Map<typeof orderedCombos[number], number>()
  if (geometry && physicsMode === 'dynamic') {
    const ordering = orderBySimulatedTime(
      filteredRankedCombos,
      offset + limit + SIMULATED_ORDER_MARGIN,
      combo => countedSimulate({ rider, frame: combo.frame, wheelset: combo.wheelset, geometry, powerSegmentsW: tttPlan?.powerSegmentsW, powerScaleAtSpeed }).elapsedSec
    )
    filteredRankedCombos = ordering.ordered
    for (const [combo, seconds] of ordering.simulatedSec) simulatedSec.set(combo, seconds)
  }
  markPhase(event, 'simulate')

  const pageCombos = filteredRankedCombos.slice(offset, offset + limit)

  if (hasRiderProfile) {
    for (const combo of pageCombos) {
      // Already computed in the full-pool ranking pass above - reuse it
      // instead of recalculating the same closed-form estimate twice.
      const legacyFinishTimeSec = combo.finishTimeSec!
      combo.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(route, combo.frame, combo.wheelset, weightKg, heightCm, wkg, laps)
      if (physicsMode === 'legacy' || !geometry) {
        combo.finishTimeSec = legacyFinishTimeSec
      } else {
        combo.finishTimeSec = simulatedSec.get(combo)
          ?? countedSimulate({ rider, frame: combo.frame, wheelset: combo.wheelset, geometry, powerSegmentsW: tttPlan?.powerSegmentsW, powerScaleAtSpeed }).elapsedSec
        if (physicsMode === 'compare') (combo as typeof combo & { legacyFinishTimeSec?: number }).legacyFinishTimeSec = legacyFinishTimeSec
      }
    }
    if (physicsMode === 'compare') pageCombos.sort((a, b) => ((a as typeof a & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity) - ((b as typeof b & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity))
    else pageCombos.sort((a, b) => (a.finishTimeSec ?? Infinity) - (b.finishTimeSec ?? Infinity))
  }
  markPhase(event, 'page')

  // "Riding as a TTT saves X vs solo": ONE extra simulation per request (top
  // combo, first page, dynamic mode only) of the same rider at the same
  // power and the same pacing plan, with the draft scaling removed. The only
  // difference between the two rides is the draft itself, so the gap is
  // exactly what the paceline is worth.
  let ttt: { riders: number, riderPowerW: number, frontPullPowerW: number, lastWheelPowerW: number, climbWkg?: number, soloFinishTimeSec?: number, tttSavedSec?: number } | undefined
  if (hasRiderProfile && draftMode === 'ttt') {
    const topCombo = pageCombos[0]
    let soloFinishTimeSec: number | undefined
    let tttSavedSec: number | undefined
    if (geometry && physicsMode === 'dynamic' && offset === 0 && topCombo && typeof topCombo.finishTimeSec === 'number') {
      soloFinishTimeSec = countedSimulate({ rider, frame: topCombo.frame, wheelset: topCombo.wheelset, geometry, powerSegmentsW: tttPlan?.powerSegmentsW }).elapsedSec
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
  // "Sitting in the bunch saves X vs solo": the same one-extra-simulation trick
  // as the TTT block above, with the race power scale removed. Race mode has no
  // pacing plan, so the two rides differ by nothing but the draft.
  let race: { savingPct: number, riderPowerW: number, soloFinishTimeSec?: number, raceSavedSec?: number } | undefined
  if (hasRiderProfile && draftMode === 'race') {
    const topCombo = pageCombos[0]
    let soloFinishTimeSec: number | undefined
    let raceSavedSec: number | undefined
    if (geometry && physicsMode === 'dynamic' && offset === 0 && topCombo && typeof topCombo.finishTimeSec === 'number') {
      soloFinishTimeSec = countedSimulate({ rider, frame: topCombo.frame, wheelset: topCombo.wheelset, geometry }).elapsedSec
      raceSavedSec = soloFinishTimeSec - topCombo.finishTimeSec
    }
    race = {
      savingPct: Math.round(RACE_DRAFT_SAVING * 100),
      riderPowerW: Math.round(rider.powerW),
      soloFinishTimeSec,
      raceSavedSec
    }
  }
  // "A bike outside your category is faster": the fastest combo once the
  // category filter is lifted. The rider-facing pages default to `standard`
  // (TT frames win outright on most routes but are restricted in a lot of
  // events), and this is what keeps that default honest - the genuinely
  // quickest bike is never silently hidden, just moved one click away. It is
  // returned from the endpoint rather than fetched separately by the client
  // so it lands in the server-rendered HTML, where crawlers and a first paint
  // both see it.
  //
  // Only the frames OUTSIDE the current category are ranked here, not the
  // full pool: if the overall winner were in-category there would be nothing
  // to disclose, so the two formulations give the same answer and this one
  // ranks a strictly smaller pool.
  //
  // Gated to the first page of an unsearched request with a rider profile -
  // the only render that shows the line - because it costs a second ranking
  // pass and its own simulation window (see `SIMULATED_ORDER_MARGIN`).
  let fastestOverall: { frameId: number, frameName: string, category: BikeCategory, wheelsetName?: string, finishTimeSec: number, deltaSec: number } | undefined
  const pageTopCombo = pageCombos[0]
  if (category && hasRiderProfile && offset === 0 && !search && pageTopCombo && typeof pageTopCombo.finishTimeSec === 'number') {
    const outsideCategoryFrames = allFrames.filter(f => f.category !== category)
    if (outsideCategoryFrames.length) {
      let candidates = rankCombos(route, outsideCategoryFrames, wheelsets, outsideCategoryFrames.length * wheelsets.length)
        .map(combo => ({ ...combo, finishTimeSec: estimateFinishTimeSec(route, combo.frame, combo.wheelset, weightKg, heightCm, wkg, laps, draftEstimate) }))
        .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
      let overallTopSec = candidates[0]?.finishTimeSec
      // Same estimate-then-simulate discipline as the main path: the estimate
      // gets the pool roughly ordered, but the number displayed next to the
      // page's own simulated times has to come from the simulator too, or the
      // gap would be comparing two different models.
      if (geometry && physicsMode === 'dynamic') {
        const ordering = orderBySimulatedTime(
          candidates,
          1 + FASTEST_OVERALL_ORDER_MARGIN,
          combo => countedSimulate({ rider, frame: combo.frame, wheelset: combo.wheelset, geometry, powerSegmentsW: tttPlan?.powerSegmentsW, powerScaleAtSpeed }).elapsedSec
        )
        candidates = ordering.ordered
        overallTopSec = candidates[0] ? ordering.simulatedSec.get(candidates[0]) : undefined
      }
      const overallTop = candidates[0]
      if (overallTop && typeof overallTopSec === 'number' && overallTopSec < pageTopCombo.finishTimeSec) {
        fastestOverall = {
          frameId: overallTop.frame.id,
          frameName: overallTop.frame.name,
          category: overallTop.frame.category,
          wheelsetName: overallTop.wheelset?.name,
          finishTimeSec: overallTopSec,
          deltaSec: pageTopCombo.finishTimeSec - overallTopSec
        }
      }
    }
  }

  markPhase(event, 'extras')
  // What the phases above cost is only half the story - these are the inputs
  // that predict it. Route distance x laps is what `simulate` scales with;
  // `sims` is how many times that distance was integrated.
  addTimingMeta(event, {
    route: route.slug,
    distanceKm: Math.round(route.distance * laps * 10) / 10,
    laps,
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
    ? ` Race draft mode: assumes you sit in a typical mass-start bunch. Your ${race.riderPowerW} W is still your OWN average for the race (average power, not normalised), and the predicted time includes the ~${race.savingPct}% power equivalent a mid-pack racer measurably gets - field-calibrated across thirteen real races, where a typical bunch spreads roughly ±3-4 percentage points, i.e. ±1-2% on finish time. This is a typical mid-pack outcome, not a win or a breakaway. The benefit fades on climbs and grows on descents automatically.`
    : ''

  // One sentence of the same thing, for the pages to lead with - the full
  // `note` is four to six sentences once a draft mode is on, which is a wall
  // of text above the results a racer came for. `note` itself is unchanged and
  // still what the MCP tools print, where there is no disclosure to open.
  const draftSummary = ttt
    ? ` Ridden as a ${ttt.riders}-rider paceline, at your own average power across the rotation.`
    : race
      ? ' Ridden in a typical mass-start bunch, at your own average power.'
      : ''

  return {
    route: toRouteSummary(route),
    combos: pageCombos,
    fastestOverall,
    physics: hasRiderProfile
      ? {
          mode: physicsMode,
          ttt,
          race,
          geometry: route.terrain.elevationProfile
            ? 'measured'
            : route.terrain.climbs.length > 0 ? 'known-climbs-compatibility' : 'aggregate-compatibility',
          rider: { weightKg, heightCm, wkg },
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
