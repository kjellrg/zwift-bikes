import type { H3Event } from 'h3'
import type { BikeCategory, ClassifiedBikeFrame, ComboScore, RouteWithMeta, Wheelset } from '../../shared/types/catalog'
import type { PhysicsRider, RouteGeometry } from '../../shared/types/physics'
import type { PowerSegmentW } from '../../shared/utils/physics'
import { getFrames } from '../../shared/utils/catalog'
import { getWheelsets } from '../../shared/utils/wheelsets'
import { capWheelsetsPerFrame, countWheelOptionsByFrame, rankCombos, searchCombos } from '../../shared/utils/scoring'
import { classifyBikeFrame, isRedundantCosmeticVariant, PURCHASABLE_HALO_FRAMES } from '../../shared/utils/classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from '../../shared/utils/finishTime'
import { confirmWheelPicks, FASTEST_OVERALL_ORDER_MARGIN, orderBySimulatedTime, RACE_DRAFT_SAVING, racePowerScaleAtSpeed, simulateRoute, SIMULATED_ORDER_MARGIN, tttFrontPullPowerW, tttLastWheelPowerW, tttPowerPlan, tttPowerScaleAtSpeed, WHEEL_OPTIONS_ORDER_MARGIN } from '../../shared/utils/physics'
import type { RecommendBaseQuery } from './apiQuerySchemas'
import type { TimingMetaValue } from './timing'
import { addTimingMeta, markPhase } from './timing'
import { upgradeFinishTimesSec } from './upgradeFinishTimes'

/**
 * The one implementation of the recommend orchestration, shared by
 * `server/api/recommend/[slug].get.ts` and
 * `server/api/recommend/segments/[slug].get.ts` (issue #77).
 *
 * Ownership/verified/Halo filtering, ranking, the estimate re-rank,
 * search-vs-cap, the simulated-time re-ordering, pagination, the page's own
 * finish times, the wheel-pick confirmation, the upgrade curve, the
 * TTT/race solo disclosures and `fastestOverall` are all the same work
 * whether the ride is a whole route or one segment, and the ordering
 * between them is subtle enough that two copies drifted every time an
 * MCP-era change landed. What genuinely differs is described by
 * `RecommendRide` below: which `RouteWithMeta` is ranked against, how the
 * ride's geometry is built, and how one combo is timed on it.
 */

/** Everything one combo's timing needs beyond the ride's own geometry. */
export interface SimulateComboOptions {
  frame: ClassifiedBikeFrame
  wheelset?: Wheelset
  /**
   * The TTT pacing plan, in the RIDE's own coordinates - a ride that
   * simulates on shifted geometry has to shift these to match.
   */
  powerSegmentsW?: PowerSegmentW[]
  /**
   * The draft power scaling. Absent for the "what would this be solo?"
   * disclosures, which are the same ride with nothing but the draft removed.
   */
  powerScaleAtSpeed?: (speedMps: number) => number
}

/** What a ride's geometry pass hands back to the pipeline. */
export interface RidePhysics {
  /**
   * The geometry a TTT power plan is built on, in the ride's own
   * coordinates. Called at most once per request, and only when a plan is
   * actually needed (a rider profile plus `tttClimbWkg`) - building one is
   * cheap next to a simulation but not free on a long route. When the
   * request simulates, this is the same geometry the sims ride; when it does
   * not (legacy mode), the ride builds an equivalent throwaway.
   */
  planGeometry: () => RouteGeometry
  /**
   * Times one combo on this ride. Present exactly when `prepare` was given a
   * rider, i.e. when this request simulates at all.
   */
  simulateSec?: (options: SimulateComboOptions) => number
}

/** The ride being ranked: a whole route, or one segment. */
export interface RecommendRide {
  /** What `rankCombos` / `estimateFinishTimeSec` / `estimateSurfaceTimePenaltySec` rank against. */
  route: RouteWithMeta
  /** Laps passed to the estimate functions: `clampLaps(route, q.laps)` for a route, 1 for a segment. */
  laps: number
  /**
   * Drop TT frames from the pool entirely (a legality filter - see
   * `excludeTT` on the route schema). A segment has no such parameter and
   * passes `false`, which is what "no such parameter" always meant here.
   */
  excludeTT: boolean
  /**
   * Ride-specific fields for the timing log line, spread in FIRST so its key
   * order is unchanged (route: `route`, `distanceKm`, `laps`; segment:
   * `segment`, `route`, `distanceKm`).
   */
  timingMeta: Record<string, TimingMetaValue>
  /**
   * Builds this ride's geometry, and the function that times one combo on
   * it. Called exactly once per request, in the `geometry` phase.
   *
   * `rider` is present exactly when this request simulates - a complete
   * rider profile AND a physics mode that runs the simulator - so a ride
   * builds its simulator geometry if and only if it is handed one.
   * `simulate` is the pipeline's counted `simulateRoute`: every integration
   * a ride runs has to go through it, or the `sims` figure in the timing log
   * stops counting the work.
   */
  prepare: (simulate: typeof simulateRoute, rider?: PhysicsRider) => RidePhysics
}

/** The "a bike your filters are hiding is faster" disclosure. */
export interface FastestOverall {
  frameId: number
  frameName: string
  category: BikeCategory
  reason: 'category' | 'halo'
  wheelsetName?: string
  finishTimeSec: number
  deltaSec: number
}

/** The "riding as a TTT saves X vs solo" disclosure. */
export interface TttDisclosure {
  riders: number
  riderPowerW: number
  frontPullPowerW: number
  lastWheelPowerW: number
  climbWkg?: number
  soloFinishTimeSec?: number
  tttSavedSec?: number
}

/** The "sitting in the bunch saves X vs solo" disclosure. */
export interface RaceDisclosure {
  savingPct: number
  riderPowerW: number
  soloFinishTimeSec?: number
  raceSavedSec?: number
}

export interface RecommendPipelineResult {
  /** The page, fully timed, sorted and annotated. */
  combos: ComboScore[]
  fastestOverall?: FastestOverall
  pagination: { offset: number, limit: number, returned: number, hasMore: boolean }
  /**
   * `undefined` without a rider profile. Each endpoint spreads this and adds
   * the wording only it can write - a route's `geometry` provenance, and the
   * `summary`/`note` sentences that describe how its own ride was modeled.
   */
  physics?: {
    mode: RecommendBaseQuery['physics']
    ttt?: TttDisclosure
    race?: RaceDisclosure
    rider: { weightKg: number, heightCm: number, powerW: number }
  }
}

export async function runRecommendPipeline(
  event: H3Event,
  query: RecommendBaseQuery,
  ride: RecommendRide
): Promise<RecommendPipelineResult> {
  const { route, laps } = ride

  // One ride integration is the unit of work these endpoints' latency is
  // made of, so the count goes out with the timing (see server/utils/timing.ts):
  // the `simulate` phase says how long, this says how many, and the two
  // together say whether a slow response was a long route or a deep candidate
  // pool. It moves with `SIMULATED_ORDER_MARGIN` and the disclosure blocks
  // below, not with the page size, which is exactly the thing that is easy to
  // change without noticing. Note a ride is free to spend more than one
  // integration per combo - the segment endpoint spends two - which is why
  // the counter wraps the simulator rather than counting `simulateSec` calls.
  let simCount = 0
  const countedSimulate: typeof simulateRoute = (options) => {
    simCount++
    return simulateRoute(options)
  }

  const {
    search: listSearch, category, limit, offset, verifiedOnly, includeHalo,
    maxWheelsetsPerFrame, wheelsForFrame, ownedOnly, owned: ownedLevels, ownedWheels: ownedWheelKeys,
    defaultUnownedLevel, physics: physicsMode, draftMode, tttRiders
  } = query
  // A drill-down ignores the list's `search`: the rider is asking what else
  // fits THIS bike, and a term that matched the frame's own name would
  // otherwise cut the wheel list down to the wheels that happen to share it.
  const search = wheelsForFrame === undefined ? listSearch : undefined
  // Note `excludeTT` must run in the stage-1 `allFrames` filter below, before
  // anything selects from the pool - that same pool also feeds the
  // `fastestOverall` disclosure, which would otherwise advertise a TT bike
  // that's illegal in the race. `includeHalo` is the opposite: a DISPLAY
  // preference, not a legality filter - it must not shrink `allFrames`,
  // because a hidden Halo winner still has to surface in `fastestOverall`.
  //
  // "Only show my garage items" only makes sense once the rider has actually
  // added something of that kind - with no bikes (or no wheels) in the
  // garage yet, fall back to showing all of them instead of filtering down
  // to zero results.
  const filterFramesByOwnership = ownedOnly && Object.keys(ownedLevels).length > 0
  const filterWheelsetsByOwnership = ownedOnly && ownedWheelKeys.size > 0
  // The schema guarantees the profile arrives complete and in bounds or not
  // at all. The zero fallbacks are never read: every consumer below is gated
  // on `hasRiderProfile`, exactly as the old code's NaN values were.
  const hasRiderProfile = query.weightKg !== undefined && query.heightCm !== undefined && query.powerW !== undefined
  const weightKg = query.weightKg ?? 0
  const heightCm = query.heightCm ?? 0
  const powerW = query.powerW ?? 0
  const tttClimbWkg = draftMode === 'ttt' ? query.tttClimbWkg : undefined

  // The rider's garage, by frame name - `isRedundantCosmeticVariant` needs to
  // know whether a cosmetic re-skin was explicitly added before it earns a row.
  const ownedFrameNames = new Set(getFrames().filter(f => f.id.toString() in ownedLevels).map(f => f.name))

  // True when `frame` is a purchasable Halo bike the ranked pool should not
  // show. Bypassed while searching - a directed search must always be able to
  // find any real, valid combo, and `searchCombos` only sees combos ranked
  // from `frames`, so the bypass has to happen here, pre-rank. Also bypassed
  // by ownership: a rider who put a Halo bike in their garage wants it
  // ranked - the same argument as `isRedundantCosmeticVariant`.
  const isHiddenHalo = (frame: { name: string }) => !includeHalo && !search
    && PURCHASABLE_HALO_FRAMES.has(frame.name) && !ownedFrameNames.has(frame.name)

  // Built WITHOUT the category and Halo filters, which are applied separately
  // below. Every other filter - cosmetic dedupe, ownership, verified -
  // belongs to both the ranked results and the `fastestOverall` comparison at
  // the end, so the two can only ever differ by those two display filters.
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
  if (ride.excludeTT) allFrames = allFrames.filter(f => f.category !== 'tt')
  const rankable = allFrames.filter(f => !isHiddenHalo(f))
  const frames = category ? rankable.filter(f => f.category === category) : rankable
  // The wheel-options drill-down: same request, same filters, same rider -
  // only the frame pool narrows, to the one frame whose card was opened.
  // Answering it here rather than from a second endpoint is what keeps the
  // times in the list and the time on the card coming out of one pipeline;
  // two pipelines over the same numbers is exactly how a drawer ends up
  // disagreeing with the row that opened it.
  const pool = wheelsForFrame === undefined ? frames : frames.filter(f => f.id === wheelsForFrame)
  // Includes this instance's lazy catalog init on a cold start - frame
  // classification and the route surface data both load on first touch.
  await markPhase(event, 'pool')

  // `rankCombos` scores every frame x wheelset pair internally regardless of
  // the `limit` passed in - it only truncates the *returned* array at the
  // end - so there's no computational reason to restrict it up front. Always
  // fetch the full candidate pool so both the search filter below and the
  // ranking step that follows see every candidate, not an arbitrary slice.
  const rankedCombos = rankCombos(route, pool, wheelsets, pool.length * wheelsets.length)
  await markPhase(event, 'rank')

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
  const rider = { weightKg, heightCm, powerW }
  // The ride builds its own geometry, and hands back the one function that
  // knows how to time a combo on it - one integration for a route, a warmed
  // run minus its warm-up for a segment.
  const { planGeometry, simulateSec } = ride.prepare(countedSimulate, hasRiderProfile && physicsMode !== 'legacy' ? rider : undefined)
  // Computed ONCE per request and shared by every combo - a per-combo plan
  // would poison `orderBySimulatedTime`'s physics-keyed dedupe cache (see
  // `physics/draft.ts`). Legacy mode has no simulator geometry but still needs
  // the plan for the estimate's two-phase split, so `planGeometry` builds one
  // just for it (geometry construction is cheap; simulation is the expensive
  // part).
  const tttPlan = hasRiderProfile && tttClimbWkg
    ? tttPowerPlan(planGeometry(), tttClimbWkg, weightKg, powerW)
    : undefined
  // The one object every draft-aware call site threads through: the draft
  // scaling for the simulator, and its closed-form twin for the estimate.
  const draftEstimate = draftMode === 'ttt'
    ? { mode: 'ttt' as const, riders: tttRiders, climb: tttPlan ? { distanceM: tttPlan.climbDistanceM, elevationM: tttPlan.climbElevationM, powerW: tttPlan.climbPowerW } : undefined }
    : draftMode === 'race' ? { mode: 'race' as const } : undefined
  const powerScaleAtSpeed = draftMode === 'ttt'
    ? (speedMps: number) => tttPowerScaleAtSpeed(tttRiders, speedMps)
    : draftMode === 'race' ? (speedMps: number) => racePowerScaleAtSpeed(speedMps) : undefined
  await markPhase(event, 'geometry')

  let orderedCombos = rankedCombos
  if (hasRiderProfile) {
    orderedCombos = rankedCombos
      .map(combo => ({ ...combo, finishTimeSec: estimateFinishTimeSec(route, combo.frame, combo.wheelset, weightKg, heightCm, powerW, laps, draftEstimate) }))
      .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
  }
  await markPhase(event, 'estimate')

  // `capWheelsetsPerFrame` must never run before `search` gets to look at
  // the full pool - see its doc comment - so it's skipped entirely while
  // searching, in favor of showing every real match, ordered frame-name
  // matches first (see `searchCombos`).
  const rankValue = (combo: ComboScore): number => (hasRiderProfile ? combo.finishTimeSec! : combo.score)
  let filteredRankedCombos = search
    ? searchCombos(orderedCombos, search)
    // For a drill-down the per-frame cap simply becomes the page size. It is
    // still `capWheelsetsPerFrame` that runs, because collapsing wheelsets
    // that produce an identical time - colourways of one physical wheel - is
    // exactly as right in the wheel list as it is in the ranking.
    : capWheelsetsPerFrame(orderedCombos, rankValue, wheelsForFrame === undefined ? maxWheelsetsPerFrame : limit)
  await markPhase(event, 'filter')

  // The cheap estimate got the pool into roughly the right order, but it is
  // NOT the signal these endpoints display: in `dynamic` mode every time a
  // rider sees comes from the simulator, and the two models disagree about
  // more than a constant offset (see `orderBySimulatedTime`). Paginating the
  // estimate's order while displaying simulated times let a combo the
  // simulator ranks 2nd sit on page two, turning up under "Show more matches"
  // faster than bikes listed above it. So the window a rider can actually
  // reach is re-ordered by real simulated time before it is paginated - and
  // the page's own simulations come out of that same pass. `compare` mode
  // keeps the estimate's ordering, since showing where the two models differ
  // is its whole purpose.
  const simulatedSec = new Map<typeof orderedCombos[number], number>()
  if (simulateSec && physicsMode === 'dynamic') {
    const ordering = orderBySimulatedTime(
      filteredRankedCombos,
      // A drill-down's pool is one frame against every wheel that fits it, so
      // it reaches the simulator very nearly in order - see the two margins.
      offset + limit + (wheelsForFrame === undefined ? SIMULATED_ORDER_MARGIN : WHEEL_OPTIONS_ORDER_MARGIN),
      combo => simulateSec({ frame: combo.frame, wheelset: combo.wheelset, powerSegmentsW: tttPlan?.powerSegmentsW, powerScaleAtSpeed })
    )
    filteredRankedCombos = ordering.ordered
    for (const [combo, seconds] of ordering.simulatedSec) simulatedSec.set(combo, seconds)
  }
  await markPhase(event, 'simulate')

  const pageCombos = filteredRankedCombos.slice(offset, offset + limit)

  if (hasRiderProfile) {
    for (const combo of pageCombos) {
      // Already computed in the full-pool ranking pass above - reuse it
      // instead of recalculating the same closed-form estimate twice.
      const legacyFinishTimeSec = combo.finishTimeSec!
      combo.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(route, combo.frame, combo.wheelset, weightKg, heightCm, powerW, laps)
      if (physicsMode === 'legacy' || !simulateSec) {
        combo.finishTimeSec = legacyFinishTimeSec
      } else {
        combo.finishTimeSec = simulatedSec.get(combo)
          ?? simulateSec({ frame: combo.frame, wheelset: combo.wheelset, powerSegmentsW: tttPlan?.powerSegmentsW, powerScaleAtSpeed })
        if (physicsMode === 'compare') (combo as typeof combo & { legacyFinishTimeSec?: number }).legacyFinishTimeSec = legacyFinishTimeSec
      }
    }
  }

  // The wheel representing a frame on a one-row-per-frame page was chosen by
  // `capWheelsetsPerFrame` from the ESTIMATE's order, before anything was
  // simulated - and the estimate names the frame's fastest wheel only about
  // 70% of the time (see `WHEEL_PICK_CONFIRM_DEPTH` for the measurement). So
  // the rows that are actually displayed get that choice checked against the
  // simulator, which is the model these endpoints' times come from: without it
  // a card can name a slower wheel than the `wheelsForFrame` list it opens
  // ranks first, and the page contradicts itself.
  //
  // Confined to `maxWheelsetsPerFrame=1` because that is the only shape where
  // a frame HAS a single representative - at a wider cap the swap could
  // collide with a sibling row of the same frame. Skipped while searching too:
  // a search lists individual wheel matches, so swapping a row's wheel could
  // silently replace the very match that was typed.
  if (hasRiderProfile && simulateSec && physicsMode === 'dynamic' && !search
    && wheelsForFrame === undefined && maxWheelsetsPerFrame === 1) {
    const picks = confirmWheelPicks({
      page: pageCombos,
      pool: orderedCombos,
      currentSec: row => row.finishTimeSec!,
      valueOf: rankValue,
      simulate: candidate => simulateSec({ frame: candidate.frame, wheelset: candidate.wheelset, powerSegmentsW: tttPlan?.powerSegmentsW, powerScaleAtSpeed }),
      alreadySimulated: simulatedSec
    })
    for (const [index, pick] of picks.entries()) {
      if (pick.row === pageCombos[index]) continue
      pick.row.finishTimeSec = pick.seconds
      pick.row.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(route, pick.row.frame, pick.row.wheelset, weightKg, heightCm, powerW, laps)
      pageCombos[index] = pick.row
    }
  }

  if (hasRiderProfile) {
    if (physicsMode === 'compare') pageCombos.sort((a, b) => ((a as typeof a & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity) - ((b as typeof b & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity))
    else pageCombos.sort((a, b) => (a.finishTimeSec ?? Infinity) - (b.finishTimeSec ?? Infinity))
  }
  // How many wheels each listed frame could still offer, counted over the FULL
  // ranked pool rather than this page - it is the wheels that did not make the
  // page that the card's disclosure exists to reach. Counted on the same value
  // the cap dedupes by, so it counts real answers rather than colourways; the
  // drill-down then returns the best `limit` of them, and the card says so
  // rather than promising 62 rows and showing six. Omitted from a drill-down's
  // own response: those rows are the answer, not another question.
  if (wheelsForFrame === undefined) {
    const wheelOptionsByFrame = countWheelOptionsByFrame(orderedCombos, rankValue)
    for (const combo of pageCombos) combo.wheelOptions = wheelOptionsByFrame.get(combo.frame.id) ?? 1
  }
  await markPhase(event, 'page')

  // "What upgrading does on THIS ride": five more integrations of the same
  // ride (the sixth stage is the time already computed above), for the one
  // combo the bike drawer is about to show. Confined to the drill-down
  // because that is the request the drawer makes and the frame it makes it
  // for - doing it per listed combo would be nine times this cost for eight
  // curves nobody opened. Same rider, laps, draft mode and wheels as
  // everything else in this response, so the curve and the time it is drawn
  // beside come out of one pipeline.
  if (hasRiderProfile && simulateSec && physicsMode === 'dynamic' && wheelsForFrame !== undefined && offset === 0) {
    const drawerCombo = pageCombos[0]
    if (drawerCombo) {
      drawerCombo.upgradeFinishTimesSec = upgradeFinishTimesSec(drawerCombo, staged => simulateSec({
        frame: staged, wheelset: drawerCombo.wheelset, powerSegmentsW: tttPlan?.powerSegmentsW, powerScaleAtSpeed
      }))
    }
  }

  // "Riding as a TTT saves X vs solo": ONE extra timing per request (top
  // combo, first page, dynamic mode only) of the same rider at the same
  // power and the same pacing plan, with the draft scaling removed. The only
  // difference between the two rides is the draft itself, so the gap is
  // exactly what the paceline is worth.
  let ttt: TttDisclosure | undefined
  if (hasRiderProfile && draftMode === 'ttt') {
    const topCombo = pageCombos[0]
    let soloFinishTimeSec: number | undefined
    let tttSavedSec: number | undefined
    if (simulateSec && physicsMode === 'dynamic' && offset === 0 && wheelsForFrame === undefined && topCombo && typeof topCombo.finishTimeSec === 'number') {
      soloFinishTimeSec = simulateSec({ frame: topCombo.frame, wheelset: topCombo.wheelset, powerSegmentsW: tttPlan?.powerSegmentsW })
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
  // "Sitting in the bunch saves X vs solo": the same one-extra-timing trick
  // as the TTT block above, with the race power scale removed. Race mode has no
  // pacing plan, so the two rides differ by nothing but the draft.
  let race: RaceDisclosure | undefined
  if (hasRiderProfile && draftMode === 'race') {
    const topCombo = pageCombos[0]
    let soloFinishTimeSec: number | undefined
    let raceSavedSec: number | undefined
    if (simulateSec && physicsMode === 'dynamic' && offset === 0 && wheelsForFrame === undefined && topCombo && typeof topCombo.finishTimeSec === 'number') {
      soloFinishTimeSec = simulateSec({ frame: topCombo.frame, wheelset: topCombo.wheelset })
      raceSavedSec = soloFinishTimeSec - topCombo.finishTimeSec
    }
    race = {
      savingPct: Math.round(RACE_DRAFT_SAVING * 100),
      riderPowerW: Math.round(rider.powerW),
      soloFinishTimeSec,
      raceSavedSec
    }
  }
  // "A bike your filters are hiding is faster": the fastest combo once the
  // category and Halo filters are lifted. The rider-facing pages default to
  // `standard` (TT frames win outright on most routes but are restricted in a
  // lot of events) and to hiding the purchasable Halo bikes (issue #112), and
  // this is what keeps those defaults honest - the genuinely quickest bike is
  // never silently hidden, just moved one click away. It is returned from the
  // endpoint rather than fetched separately by the client so it lands in the
  // server-rendered HTML, where crawlers and a first paint both see it.
  //
  // Only the frames the ranked pool can't show are ranked here - everything
  // outside the current category plus anything Halo-hidden (which can be
  // IN-category: the R4000 is `standard`). If the overall winner were
  // showable there would be nothing to disclose, so the two formulations give
  // the same answer and this one ranks a strictly smaller pool. `reason`
  // records which filter hid the winner, so the UI can offer the right way
  // to reveal it.
  //
  // Gated to the first page of an unsearched request with a rider profile -
  // the only render that shows the line - because it costs a second ranking
  // pass and its own simulation window (see `SIMULATED_ORDER_MARGIN`).
  let fastestOverall: FastestOverall | undefined
  const pageTopCombo = pageCombos[0]
  if ((category || !includeHalo) && hasRiderProfile && offset === 0 && !search && wheelsForFrame === undefined && pageTopCombo && typeof pageTopCombo.finishTimeSec === 'number') {
    const hiddenFrames = allFrames.filter(f => (category && f.category !== category) || isHiddenHalo(f))
    if (hiddenFrames.length) {
      let candidates = rankCombos(route, hiddenFrames, wheelsets, hiddenFrames.length * wheelsets.length)
        .map(combo => ({ ...combo, finishTimeSec: estimateFinishTimeSec(route, combo.frame, combo.wheelset, weightKg, heightCm, powerW, laps, draftEstimate) }))
        .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
      let overallTopSec = candidates[0]?.finishTimeSec
      // Same estimate-then-simulate discipline as the main path: the estimate
      // gets the pool roughly ordered, but the number displayed next to the
      // page's own simulated times has to come from the simulator too, or the
      // gap would be comparing two different models. It goes through the same
      // `simulateSec` the ranked results use, so the two times are directly
      // comparable.
      if (simulateSec && physicsMode === 'dynamic') {
        const ordering = orderBySimulatedTime(
          candidates,
          1 + FASTEST_OVERALL_ORDER_MARGIN,
          combo => simulateSec({ frame: combo.frame, wheelset: combo.wheelset, powerSegmentsW: tttPlan?.powerSegmentsW, powerScaleAtSpeed })
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
          // A frame that is both out-of-category AND Halo-hidden reports
          // `halo`: switching to "All categories" alone would still not
          // reveal it, while including Halo bikes at least discloses the
          // remaining category gap on the refetch.
          reason: isHiddenHalo(overallTop.frame) ? 'halo' as const : 'category' as const,
          wheelsetName: overallTop.wheelset?.name,
          finishTimeSec: overallTopSec,
          deltaSec: pageTopCombo.finishTimeSec - overallTopSec
        }
      }
    }
  }

  await markPhase(event, 'extras')
  // What the phases above cost is only half the story - these are the inputs
  // that predict it. Ride distance is what `simulate` scales with; `sims` is
  // how many times that distance was integrated.
  addTimingMeta(event, {
    ...ride.timingMeta,
    physics: physicsMode,
    draft: draftMode,
    category,
    profile: hasRiderProfile,
    combos: rankedCombos.length,
    sims: simCount,
    offset,
    searching: Boolean(search),
    wheelDrillDown: wheelsForFrame !== undefined
  })

  return {
    combos: pageCombos,
    fastestOverall,
    physics: hasRiderProfile
      ? { mode: physicsMode, ttt, race, rider: { weightKg, heightCm, powerW: Math.round(powerW) } }
      : undefined,
    pagination: {
      offset,
      limit,
      returned: pageCombos.length,
      hasMore: filteredRankedCombos.length > offset + pageCombos.length
    }
  }
}

/**
 * The three draft sentences both endpoints append to their `summary`/`note`.
 * Word-for-word identical between them apart from `effortNoun`, which names
 * what the rider's average power is an average FOR - "the race" on a whole
 * route, "the effort" on a single segment.
 */
export function draftNotes(
  physics: RecommendPipelineResult['physics'],
  effortNoun: string
): { tttNote: string, raceNote: string, draftSummary: string } {
  const ttt = physics?.ttt
  const race = physics?.race

  const tttNote = ttt
    ? ` TTT draft mode: your ${ttt.riderPowerW} W is your OWN average across a full rotation of ${ttt.riders} riders - you hold about ${ttt.frontPullPowerW} W while pulling on the front and sit around ${ttt.lastWheelPowerW} W in the last wheel, so the group covers ground like a solo rider at ~${ttt.frontPullPowerW} W on the flat. The benefit fades as the group slows on climbs and grows on descents${ttt.climbWkg !== undefined ? `; long climbs (3%+ for 3.5+ min) are paced at your team's ${ttt.climbWkg.toFixed(1)} W/kg` : ''}.`
    : ''

  const raceNote = race
    ? ` Race draft mode: assumes you sit in a typical mass-start bunch. Your ${race.riderPowerW} W is still your OWN average for ${effortNoun} (average power, not normalised), and the predicted time includes the ~${race.savingPct}% power equivalent a mid-pack racer measurably gets - field-calibrated across thirteen real races, where a typical bunch spreads roughly ±3-4 percentage points, i.e. ±1-2% on finish time. This is a typical mid-pack outcome, not a win or a breakaway. The benefit fades on climbs and grows on descents automatically.`
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

  return { tttNote, raceNote, draftSummary }
}
