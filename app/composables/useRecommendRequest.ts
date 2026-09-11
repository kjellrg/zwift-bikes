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
    deltaSec: number
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
  const asyncData = useAsyncData<RecommendEnvelope<RecommendResponse>>(
    options.key,
    async () => {
      // Read before the await: the envelope must record the request this
      // result was fetched WITH, not whatever the refs hold when it lands.
      const target = endpoint.value
      const forQuery = serializedQuery.value
      const result = target ? await $fetch<RecommendResponse>(target, { query: query.value }) : null
      return { endpoint: target, forQuery, result }
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
  // Nuxt resets `data` to its default when a refresh throws, which would
  // empty the list under the very toast that says the previous results are
  // still shown (`useRefetchNotice`). So the envelope last served stays the
  // one on screen until a response replaces it. A computed rather than a
  // watcher because no watcher runs after setup on the server, where the
  // page reads this straight after awaiting the fetch. A no-endpoint ride
  // still clears the list: its envelope is a real one with a null result.
  let servedEnvelope: RecommendEnvelope<RecommendResponse> | null = null
  const recommendData = computed(() => {
    if (envelope.value) servedEnvelope = envelope.value
    return servedEnvelope?.result ?? null
  })
  useRefetchNotice(error, status, refresh)

  /**
   * The Ride the combos on screen were computed for. `currentRide` moves the
   * header stats immediately, which is right - but every speed readout
   * divides a distance by a `finishTimeSec` from the last response, and
   * pairing a NEW lap count with an OLD time shows a wrong km/h until the
   * refetch lands. The cards and FAQ read this lagged Ride instead, which
   * catches up exactly when the recomputed times do.
   */
  const appliedRide = ref<Ride>(currentRide.value)
  /**
   * The rider the combos on screen were computed for - see **Applied** in
   * `CONTEXT.md`. Same rule and same lifecycle as `appliedRide`: the
   * controls run ahead of it between a slider's release and the response,
   * so the strip, the answer and the equipment-dependent analysis read this
   * rather than the stored profile, and a failed refresh leaves it where it
   * was, beside the results it still describes.
   */
  const appliedInputs = ref<AppliedRiderInputs>(riderInputsForRide(inputs.value, currentRide.value))
  const results = useRecommendResults<ComboScore>({
    recommendData,
    refresh,
    fetchPage: (offset, limit) => endpoint.value
      ? $fetch<RecommendResponse>(endpoint.value, { query: { ...query.value, offset, limit } })
      : Promise.resolve({ combos: [] }),
    pageSize: RECOMMEND_MAX_LIMIT,
    onResultsApplied: () => {
      appliedRide.value = currentRide.value
      appliedInputs.value = riderInputsForRide(inputs.value, currentRide.value)
    }
  })
  const { loadedCombos, loadingMore, reloadingPages, showMore, refreshFirstPage, reloadLoadedPages } = results

  /**
   * The list plumbing above applies a response through a watcher, and Vue
   * runs no watcher after setup on the server - so on a server render, where
   * this composable is created before its own fetch resolves, the response is
   * read straight off `recommendData` instead. In the browser the watcher is
   * the source of truth: it is what "show more" appends to and what a garage
   * reload swaps out.
   */
  const combos = computed(() => import.meta.server ? (recommendData.value?.combos ?? []) : loadedCombos.value)
  const hasMore = computed(() => import.meta.server ? (recommendData.value?.pagination?.hasMore ?? false) : results.hasMore.value)

  // The one refetch trigger. `recommendChangeKind` reads which keys moved:
  // the garage toggles live on the result cards themselves, so one can be
  // fired from result 30 and every expanded page is reloaded in place, while
  // every other control sits above the list and resets it to page one.
  let lastRequest: RecommendRequest = { endpoint: endpoint.value, query: query.value }
  watch(() => `${endpoint.value}\n${serializedQuery.value}`, () => {
    const next: RecommendRequest = { endpoint: endpoint.value, query: query.value }
    const kind = recommendChangeKind(lastRequest, next)
    lastRequest = next
    if (kind === 'refresh') refreshFirstPage()
    else if (kind === 'reload') reloadLoadedPages()
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
  const restCombos = computed(() => combos.value.slice(1))
  const fastestTimeSec = computed(() => {
    const times = combos.value.map(combo => combo.finishTimeSec).filter((time): time is number => typeof time === 'number')
    return times.length ? Math.min(...times) : undefined
  })

  // `recommendData` keeps its previous value while a refetch is in flight, so
  // `status === 'pending'` alone can't tell a genuine first load (nothing to
  // show yet) apart from a refresh of already-visible results (show stale
  // cards plus a subtle "updating" hint).
  const isFirstLoad = computed(() => status.value === 'pending' && !recommendData.value)
  const isRefreshing = computed(() => (status.value === 'pending' || reloadingPages.value) && !!recommendData.value)
  // Announced to assistive tech when a refetch lands: the visual cue is
  // opacity and a spinner only. Cleared first so consecutive refreshes
  // re-announce (a live region only speaks on change).
  const resultsAnnouncement = ref('')
  watch(isRefreshing, async (refreshing, wasRefreshing) => {
    if (!wasRefreshing || refreshing) return
    resultsAnnouncement.value = ''
    await nextTick()
    resultsAnnouncement.value = 'Results updated'
  })

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
    restCombos,
    fastestTimeSec,
    hasMore,
    loadingMore,
    showMore,
    appliedRide,
    appliedInputs,
    isFirstLoad,
    isRefreshing,
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
    loadWheelOptions,
    owned
  }
}
