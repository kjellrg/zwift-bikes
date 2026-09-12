import type { InternalApi } from 'nitropack/types'
import type { ComboScore } from '../../shared/types/catalog'
import { RECOMMEND_MAX_LIMIT } from '#shared/utils/recommendLimits'
import {
  buildRecommendQuery,
  cachedRecommendToServe,
  recommendChangeKind,
  riderInputsForRide,
  serializeRecommendQuery,
  type AppliedRiderInputs,
  type RecommendEnvelope,
  type RecommendRequest,
  type Ride,
  type RiderInputs
} from '../utils/recommendRequest'

/**
 * What both recommend endpoints return, as the pages read it.
 *
 * Declared rather than inferred: the endpoint is a string on a `Ride`, so
 * Nitro can't resolve it to one route's response type. The two assertions
 * below are what keep it honest - both endpoints must stay assignable to it,
 * so a renamed or dropped field on either is a type error here rather than a
 * page quietly rendering `undefined`.
 */
export interface RecommendResponse {
  combos: ComboScore[]
  fastestOverall?: {
    frameName: string
    category: ComboScore['frame']['category']
    reason: 'category' | 'halo'
    wheelsetName?: string
    /** Absent when the filters left no rank 1 to measure the gap against - see `FastestOverall`. */
    deltaSec?: number
  }
  physics?: {
    mode: string
    summary?: string
    note: string
    ttt?: { riders: number, frontPullPowerW: number, tttSavedSec?: number }
    race?: { savingPct: number, raceSavedSec?: number }
  }
  pagination?: { hasMore: boolean }
}
type EndpointReturning<T extends RecommendResponse> = T
export type RouteEndpointResponse = EndpointReturning<InternalApi['/api/recommend/:slug']['get']>
export type SegmentEndpointResponse = EndpointReturning<InternalApi['/api/recommend/segments/:slug']['get']>

/**
 * How many wheel choices a card's disclosure asks for. Capped by the API's
 * own `limit` (`RECOMMEND_MAX_LIMIT`), and deliberately short of it: past
 * half a dozen the list is answering a question nobody asked, and every
 * extra row is another route simulation paid on a click.
 */
const WHEEL_OPTIONS_LIMIT = 6

/** How long the search box sits still before the ranking is refetched for it. */
const SEARCH_DEBOUNCE_MS = 300

export interface RecommendRequestOptions {
  /**
   * The `useAsyncData` key. Two rules, and each of them is a bug that got
   * out:
   *
   * - **Fixed for the life of the page** - read from a ref once, at setup,
   *   never a computed. A reactive key executes the fetch by itself on every
   *   change (Nuxt watches it with `flush: 'sync'`, so it fires once per
   *   mutated ref), and one control can move two refs at once: a race page's
   *   group switch changes the route and the lap count together.
   * - **Unique to what the page ranks** (`recommend-route-<slug>`). Nuxt
   *   hands a second caller of an existing key the first caller's data
   *   without consulting `getCachedData` at all, so a key shared by every
   *   route page serves the previous route's ranking under the new route's
   *   name after a client-side navigation - which is #161 itself.
   */
  key: string
}

/**
 * The recommendation request behind the route, segment and race pages: the
 * stored rider state it is built from, the one fetch that answers it, the
 * cache contract that decides when that fetch reaches the network, and the
 * results list it feeds.
 *
 * A page hands over a `Ride` (see `CONTEXT.md`) and gets back what to render.
 * It owns none of the query, none of the refetch triggers and none of the
 * cache rules - those were three hand-maintained copies, nine commits since
 * July touched all three in one diff, and the contract behind #118/#121 was
 * written down on one page and held on the other two only through Nuxt
 * internals.
 *
 * Synchronous, returning a `ready` promise rather than awaiting internally:
 * an `await` inside a plain composable loses the Nuxt instance for
 * everything after it, and pages need to await this alongside their own
 * route/segment lookup anyway.
 */
export function useRecommendRequest(ride: () => Ride, options: RecommendRequestOptions) {
  const currentRide = computed(ride)
  const endpoint = computed(() => currentRide.value.endpoint)

  const { owned, ownedWheels, load: loadGarage } = useGarage()
  // Read-only here: the controls that write these (sliders, draft
  // disclosure, category and switches) live in `RideRiderSummary` -
  // `RiderProfileControls` folded behind it - and `RideEquipmentFilters`,
  // which every ranking page mounts and which bind and persist the same
  // `useState`-backed state this reads.
  const {
    weightKg, heightCm, powerW, sprintPowerW, defaultUnownedLevel, draftMode, tttRiders, tttClimbWkg,
    load: loadRiderProfile
  } = useRiderProfile()
  const { verifiedOnly, myBikesOnly, bikeCategory, includeHaloBikes, load: loadPreferences } = usePreferences()

  const bikeSearch = ref('')
  const bikeSearchDebounced = ref('')
  let bikeSearchDebounceTimer: ReturnType<typeof setTimeout> | undefined
  watch(bikeSearch, (value) => {
    clearTimeout(bikeSearchDebounceTimer)
    bikeSearchDebounceTimer = setTimeout(() => {
      bikeSearchDebounced.value = value
    }, SEARCH_DEBOUNCE_MS)
  })
  onScopeDispose(() => clearTimeout(bikeSearchDebounceTimer))

  const inputs = computed<RiderInputs>(() => ({
    weightKg: weightKg.value,
    heightCm: heightCm.value,
    powerW: powerW.value,
    sprintPowerW: sprintPowerW.value,
    defaultUnownedLevel: defaultUnownedLevel.value,
    draftMode: draftMode.value,
    tttRiders: tttRiders.value,
    tttClimbWkg: tttClimbWkg.value,
    verifiedOnly: verifiedOnly.value,
    myBikesOnly: myBikesOnly.value,
    bikeCategory: bikeCategory.value,
    includeHaloBikes: includeHaloBikes.value,
    owned: owned.value,
    ownedWheels: ownedWheels.value,
    search: bikeSearchDebounced.value
  }))
  const query = computed(() => buildRecommendQuery(inputs.value, currentRide.value))
  const serializedQuery = computed(() => serializeRecommendQuery(query.value))

  function captureRequest() {
    const rider = Object.freeze({
      ...inputs.value,
      owned: Object.freeze({ ...inputs.value.owned }),
      ownedWheels: Object.freeze({ ...inputs.value.ownedWheels })
    })
    const ride = Object.freeze({ ...currentRide.value })
    return Object.freeze({ rider, ride, query: Object.freeze(buildRecommendQuery(rider, ride)) })
  }
  type Provenance = ReturnType<typeof captureRequest>
  type Ranking = RecommendEnvelope<RecommendResponse> & {
    provenance: Provenance
    pages: number
    generation?: number
  }
  const initialRequest = captureRequest()
  const accepted = ref<Ranking | null>(null)
  /**
   * Spoken to assistive tech when a ranking is accepted, which is the only
   * event worth hearing: the visual cue is a spinner and some opacity, a
   * refresh that failed or was superseded leaves the screen as it was, and
   * loading stopping is not by itself an update. Silent on the ranking a
   * page arrives with - nothing changed for the rider to be told about, and
   * every visit would speak - but not on one they had to ask for again,
   * where a failure notice is what disappears.
   */
  const resultsAnnouncement = ref('')
  let failedSinceAcceptance = false
  let generation = 0
  let requested = false
  let observed: Ranking | null = null
  const loadingMore = ref(false)
  /**
   * Whether the last attempt to add a page to the accepted ranking failed.
   * The rows and the position it failed from are untouched, so the attempt
   * can simply be made again - but nothing else on the page would show that
   * the press did anything at all, and a silently ignored button reads as a
   * ranking with no more to give. Cleared by the next attempt and by any
   * ranking that replaces this one, neither of which it describes.
   */
  const expansionFailed = ref(false)
  let expansion = 0

  /**
   * The one place a ranking becomes the one on screen. Everything that
   * explains a row is read from here, so accepting is also the only moment
   * worth announcing - see `resultsAnnouncement`. Adding rows to the
   * ranking already accepted does not come through here (see `showMore`):
   * same provenance, same explanations, more of the same list.
   */
  function acceptRanking(candidate: Ranking) {
    const replaces = accepted.value !== null || failedSinceAcceptance
    failedSinceAcceptance = false
    expansionFailed.value = false
    accepted.value = candidate
    if (replaces) resultsAnnouncement.value = 'Results updated'
  }

  const appliedRanking = computed(() => {
    const candidate = envelope.value
    if (candidate && candidate !== observed) {
      observed = candidate
      if (!requested || (candidate.generation === generation
        && candidate.endpoint === endpoint.value && candidate.forQuery === serializedQuery.value)) {
        acceptRanking(candidate)
      }
    }
    return accepted.value
  })

  /**
   * One `useAsyncData` under a key that never changes (see
   * `RecommendRequestOptions.key`), with the watcher below as its only
   * refetch trigger (`watch: []` - `useAsyncData`'s spelling of `useFetch`'s
   * `watch: false`).
   *
   * What makes that safe is the envelope plus `getCachedData`: the result is
   * stored with the endpoint and the serialised query it was fetched FOR,
   * and `cachedRecommendToServe` decides from those whether a cached entry
   * may answer the request being made. Without it, the payload Nuxt
   * prefetches for a client-side navigation - rendered for the DEFAULT rider
   * profile - answers every rider, and nothing later corrects it. That is
   * the whole #118/#121 contract, and it is tested in
   * `app/utils/recommendRequest.test.ts`.
   */
  const asyncData = useAsyncData<Ranking>(
    options.key,
    async () => {
      const previous = accepted.value
      const provenance = captureRequest()
      const target = provenance.ride.endpoint
      const forQuery = serializeRecommendQuery(provenance.query)
      const token = ++generation
      requested = true
      expansion += 1
      loadingMore.value = false
      const pageCount = previous && recommendChangeKind(
        { endpoint: previous.endpoint, query: previous.provenance.query },
        { endpoint: target, query: provenance.query }
      ) !== 'refresh'
        ? previous.pages
        : 1
      const responses = target
        ? await Promise.all(Array.from({ length: pageCount }, (_, index) =>
            $fetch<RecommendResponse>(target, { query: { ...provenance.query, offset: index * RECOMMEND_MAX_LIMIT } })
          ))
        : []
      const first = responses[0]
      const result = first
        ? {
            ...first,
            combos: responses.flatMap(page => page.combos),
            pagination: responses.at(-1)?.pagination
          }
        : null
      return {
        endpoint: target, forQuery, result, provenance,
        pages: Math.max(1, Math.ceil((result?.combos.length ?? 0) / RECOMMEND_MAX_LIMIT)),
        generation: token
      }
    },
    {
      watch: [],
      getCachedData: (key, nuxtApp, ctx) => cachedRecommendToServe({
        cause: ctx.cause,
        isHydrating: Boolean(nuxtApp.isHydrating),
        hydrationEntry: nuxtApp.payload.data[key],
        navigationEntry: nuxtApp.static.data[key],
        endpoint: endpoint.value,
        serializedQuery: serializedQuery.value
      })
    }
  )
  const { data: envelope, status, error, refresh } = asyncData
  // `appliedRanking` decides acceptance where it is read, which is what
  // keeps it right under SSR: a watcher never flushes there, but the first
  // render reads the ranking. On the client a landed response must not wait
  // for a reader - acceptance announces itself, and the live region is
  // rendered above the results, so it would otherwise hear about a ranking
  // a render after the rows did.
  watch(envelope, () => void appliedRanking.value)
  const recommendData = computed(() => appliedRanking.value?.result ?? null)
  useRefetchNotice(error, status, refresh)

  /**
   * The Ride the combos on screen were computed for. `currentRide` moves the
   * header stats immediately, which is right - but every speed readout
   * divides a distance by a `finishTimeSec` from the last response, and
   * pairing a NEW lap count with an OLD time shows a wrong km/h until the
   * refetch lands. The cards and FAQ read this lagged Ride instead, which
   * catches up exactly when the recomputed times do.
   */
  const appliedRide = computed(() => (appliedRanking.value?.provenance ?? initialRequest).ride)
  /**
   * The rider the combos on screen were computed for - see **Applied** in
   * `CONTEXT.md`. Same rule and same lifecycle as `appliedRide`: the
   * controls run ahead of it between a slider's release and the response,
   * so the strip, the answer and the equipment-dependent analysis read this
   * rather than the stored profile, and a failed refresh leaves it where it
   * was, beside the results it still describes.
   */
  const appliedInputs = computed<AppliedRiderInputs>(() => {
    const provenance = appliedRanking.value?.provenance ?? initialRequest
    return riderInputsForRide(provenance.rider, provenance.ride)
  })
  const appliedRestrictions = computed(() => (appliedRanking.value?.provenance ?? initialRequest).rider)
  const combos = computed(() => recommendData.value?.combos ?? [])
  /**
   * Whether there is a ranking on screen to keep. Not "are there rows": a
   * ranking that legitimately matched nothing is still the answer on
   * screen and still worth keeping through a failed refresh. A first load
   * that failed has nothing behind its empty state, and neither has a Ride
   * with no endpoint to rank.
   */
  const hasRanking = computed(() => !!recommendData.value)
  const hasMore = computed(() => recommendData.value?.pagination?.hasMore ?? false)
  const isOutdated = computed(() => appliedRanking.value?.endpoint !== endpoint.value
    || appliedRanking.value?.forQuery !== serializedQuery.value)
  const canShowMore = computed(() => hasMore.value && status.value !== 'pending' && !isOutdated.value && !loadingMore.value)

  async function showMore() {
    const ranking = appliedRanking.value
    if (!canShowMore.value || !ranking?.endpoint || !ranking.result) return
    const token = ++expansion
    loadingMore.value = true
    expansionFailed.value = false
    try {
      const page = await $fetch<RecommendResponse>(ranking.endpoint, {
        query: { ...ranking.provenance.query, offset: ranking.result.combos.length, limit: RECOMMEND_MAX_LIMIT }
      })
      if (token !== expansion || appliedRanking.value !== ranking || isOutdated.value) return
      // More of the ranking already accepted, not a new one: it keeps its
      // provenance and its explanations, so it does not go through
      // `acceptRanking` and nothing is announced.
      accepted.value = {
        ...ranking,
        result: { ...ranking.result, combos: [...ranking.result.combos, ...page.combos], pagination: page.pagination },
        pages: ranking.pages + 1
      }
    } catch {
      if (token === expansion) expansionFailed.value = true
    } finally {
      if (token === expansion) loadingMore.value = false
    }
  }

  // The one refetch trigger. `recommendChangeKind` reads which keys moved:
  // the garage toggles live on the result cards themselves, so one can be
  // fired from result 30 and every expanded page is reloaded in place, while
  // every other control sits above the list and resets it to page one.
  let lastRequest: RecommendRequest = { endpoint: endpoint.value, query: query.value }
  watch(() => `${endpoint.value}\n${serializedQuery.value}`, () => {
    const next: RecommendRequest = { endpoint: endpoint.value, query: query.value }
    const kind = recommendChangeKind(lastRequest, next)
    lastRequest = next
    if (kind !== 'none') refresh()
  })

  onMounted(() => {
    // The two control components load these themselves, but they aren't
    // always mounted - a race group with no catalog route renders neither -
    // and the query wants the rider's stored state regardless. The profile
    // and preferences read storage once per app lifetime and return on
    // every later call; the garage re-reads but guards with a JSON-equality
    // check. Either way a repeat call assigns nothing, so running them from
    // every mount costs nothing, fires no refetch, and cannot undo a value
    // `useSharedView` assigned for the visit.
    loadGarage()
    loadRiderProfile()
    loadPreferences()
  })

  /**
   * The wheel list behind a result card's disclosure. Fetched on click
   * through the endpoint's `wheelsForFrame` drill-down with the live query,
   * so the times in the list come out of the same pipeline - same rider,
   * same laps, same draft mode, same garage, and the ride's own equipment
   * rules - as the time on the card that opened it.
   */
  async function loadWheelOptions(frameId: number): Promise<ComboScore[]> {
    if (!endpoint.value) return []
    const data = await $fetch<RecommendResponse>(endpoint.value, {
      query: { ...query.value, wheelsForFrame: frameId, offset: 0, limit: WHEEL_OPTIONS_LIMIT }
    })
    return data.combos ?? []
  }

  const topCombo = computed(() => combos.value[0])
  const fastestTimeSec = computed(() => {
    const times = combos.value.map(combo => combo.finishTimeSec).filter((time): time is number => typeof time === 'number')
    return times.length ? Math.min(...times) : undefined
  })

  // `recommendData` keeps its previous value while a refetch is in flight, so
  // `status === 'pending'` alone can't tell a genuine first load (nothing to
  // show yet) apart from a refresh of already-visible results (show stale
  // cards plus a subtle "updating" hint).
  //
  // The pages dim the results on this and nothing more. They used to make
  // them inert as well, which took away the three things a rider can do
  // with rows that are still perfectly good - compare them, open one, look
  // at a frame's other wheels - for as long as a request they did not ask
  // to wait for. Everything those controls reach now belongs to the
  // accepted ranking (the drawer follows its combo, the wheel list is
  // fetched under its request), so there is nothing left for inertness to
  // protect. Show more is the exception and gates itself on `canShowMore`:
  // a page appended to a ranking that is being replaced would not belong
  // to either.
  const isFirstLoad = computed(() => status.value === 'pending' && !recommendData.value)
  const isRefreshing = computed(() => status.value === 'pending' && !!recommendData.value)
  /**
   * Whether the last required refresh failed, and so whether what is on
   * screen still answers the controls. It covers the whole operation - an
   * expanded Garage refresh fails as one, however many of its pages
   * succeeded - and it stands until the next attempt begins, which is when
   * the updating indicator takes the notice's place; if that attempt fails
   * too, it is raised again. A superseded attempt cannot raise or clear it:
   * `useAsyncData` reports only the latest execution.
   */
  const refreshFailed = computed(() => status.value === 'error')
  // Every refresh silences the region on its way out, so an acceptance can
  // set the same words again and still be heard: a live region only speaks
  // on change, and there is no refresh that does not pass through pending.
  watch(status, (value) => {
    if (value === 'error') failedSinceAcceptance = true
    if (value === 'pending' || value === 'error') resultsAnnouncement.value = ''
  })

  /**
   * Ask for the ranking again after a failure, from the rider's choices as
   * they stand now rather than the ones the failed attempt carried. It is
   * the same operation the controls trigger, so it requires the same pages:
   * every expanded page when only the Garage has moved since the accepted
   * ranking, the first page alone otherwise. Nothing is accepted unless all
   * of them arrive, so a second failure leaves the previous ranking whole.
   */
  const retry = () => refresh()

  return {
    /** Awaited by the page alongside its own route/segment lookup, so both requests are in flight together. */
    ready: asyncData as Promise<unknown>,
    recommendData,
    physics: computed(() => recommendData.value?.physics),
    /** Present only when the category or Halo filter is hiding a faster combo - see `FastestOverallNote`. */
    fastestOverall: computed(() => recommendData.value?.fastestOverall),
    /** What is on screen: the loaded pages in the browser, the fetched page on the server. */
    combos,
    topCombo,
    fastestTimeSec,
    hasMore,
    canShowMore,
    loadingMore,
    expansionFailed,
    showMore,
    appliedRide,
    appliedInputs,
    appliedRestrictions,
    hasRanking,
    isFirstLoad,
    isRefreshing,
    refreshFailed,
    retry,
    resultsAnnouncement,
    /** `v-model:search` for `RideAlternatives`; the composable debounces it into the query. */
    bikeSearch,
    /** The settled search term - what the query was actually built from, and what a page writes to the URL. */
    bikeSearchDebounced,
    /**
     * The serialised query the results on screen belong to, for anything that
     * has to notice when the ride being ranked changes underneath it. The bike
     * drawer keys its route upgrade curve on this (`upgradeCurveKey`); nothing
     * parses it back out.
     */
    serializedQuery,
    loadWheelOptions
  }
}
