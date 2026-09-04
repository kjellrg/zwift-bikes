import { ref, watch, type Ref } from 'vue'

/** The slice of a recommend response the list plumbing needs; `T` is whatever combo shape the page gets back. */
export interface RecommendPage<T> {
  combos?: T[]
  pagination?: { hasMore?: boolean }
}

export interface RecommendResultsOptions<T> {
  /** The first page, as held by the page's `useFetch`/`useAsyncData`. */
  recommendData: Ref<RecommendPage<T> | null | undefined>
  /** Refetches the first page in place (the `refresh` of that same fetch). */
  refresh: () => Promise<unknown>
  /** Fetches one deeper page with the page's live query. */
  fetchPage: (offset: number, limit: number) => Promise<RecommendPage<T>>
  pageSize: number
  /**
   * Called each time a fresh, complete result set is on screen - the first
   * page landing, or a multi-page reload finishing. NOT called for a page
   * that was fetched under a query that has since changed. The route and
   * race pages use it to advance the lap count their speed readouts divide
   * by, which must move exactly when the times computed for it arrive.
   */
  onResultsApplied?: () => void
}

/**
 * The results list behind the route, segment and race pages: the combos on
 * screen, the "show more" pagination, and the two ways the list gets rebuilt
 * when the query changes. One implementation for all three pages so the
 * ordering rules below cannot drift apart (issue #153 found the same race in
 * three copies).
 *
 * Every request carries an epoch token. A control change (`refreshFirstPage`)
 * or a garage change (`reloadLoadedPages`) advances it, and any response that
 * comes back under an older token is dropped: a page fetched for the OLD
 * query must never be appended to, or reset `hasMore` for, the new one.
 * Without that, changing a filter while page 2 was in flight appended nine
 * combos ranked under the previous category and power below a fresh first
 * page - TT bikes under a standard-only ranking, with times to match.
 */
export function useRecommendResults<T>(options: RecommendResultsOptions<T>) {
  const { recommendData, refresh, fetchPage, pageSize, onResultsApplied } = options

  const loadedCombos = ref<T[]>([]) as Ref<T[]>
  const hasMore = ref(true)
  const loadingMore = ref(false)
  // How many pages of results are on screen. The garage toggles live on the
  // result cards themselves, so one can be fired from result 30 - and refetching
  // only the first page would drop the list back to nine cards, make the page
  // abruptly shorter, and leave the browser clamping scrollY to the new maximum:
  // the rider ends up at the top of the page with the bike they were looking at
  // three pages away. Every other control that triggers a refetch sits ABOVE the
  // list, where the rider is already at the top, so those still reset to one
  // page - see `reloadLoadedPages`.
  const loadedPages = ref(1)
  // Set while `reloadLoadedPages` is rebuilding the list: the watcher below
  // would otherwise apply the first page on its own and cause exactly the
  // collapse that function exists to avoid.
  const reloadingPages = ref(false)
  // The epoch described above. Read before every await, compared after.
  let epoch = 0

  watch(recommendData, (data) => {
    if (reloadingPages.value) return
    if (!data) {
      // The race page selects a category group with no catalog route: clear
      // the list rather than leave the previous group's ranking sitting
      // under the wrong heading. On the other pages data is never null once
      // loaded, so this branch is inert there.
      loadedCombos.value = []
      hasMore.value = false
      return
    }
    loadedCombos.value = data.combos ?? []
    hasMore.value = data.pagination?.hasMore ?? false
    onResultsApplied?.()
  }, { immediate: true })

  async function refreshFirstPage() {
    epoch += 1
    loadedPages.value = 1
    // Keep the current results mounted while the new recommendation request is
    // running. Clearing the cards first makes the page temporarily much shorter,
    // which causes the browser to clamp scrollY back to the top. The refreshed
    // results will replace these in-place once the request completes.
    await refresh()
  }

  async function showMore() {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    const token = epoch
    try {
      const nextPage = await fetchPage(loadedCombos.value.length, pageSize)
      // The query moved while this page was in flight; the watcher above has
      // already put the new first page on screen. This page belongs to the
      // old ranking, so it is dropped whole - including its `hasMore`.
      if (token !== epoch) return
      loadedCombos.value = [...loadedCombos.value, ...(nextPage.combos ?? [])]
      hasMore.value = nextPage.pagination?.hasMore ?? false
      loadedPages.value += 1
    } finally {
      loadingMore.value = false
    }
  }

  /**
   * Refetches every page the rider has expanded to and swaps the whole list in
   * one assignment, so an expanded list comes back the same length it went in.
   *
   * `limit` is capped at `RECOMMEND_MAX_LIMIT` server-side - that cap IS the
   * per-request CPU bound - so "ask for one bigger page" is not available, and
   * the pages go out in parallel instead. The cards already on screen stay
   * mounted until every one of them has answered: applying the first page as
   * soon as it lands would show a bike twice for the length of a round trip,
   * once in its new position and once in its stale one.
   */
  async function reloadLoadedPages() {
    if (loadedPages.value <= 1) return refreshFirstPage()
    const token = ++epoch
    reloadingPages.value = true
    try {
      // Both started before either is awaited, so the first page and the deeper
      // ones are in flight together. The first page goes through the page's
      // own refresh rather than a bare fetch because the physics block and the
      // `fastestOverall` note read `recommendData` directly, and they move with
      // the garage too.
      const deeperPages = Promise.all(Array.from(
        { length: loadedPages.value - 1 },
        (_, index) => fetchPage((index + 1) * pageSize, pageSize)
      ))
      const firstPage = refresh()
      const rest = await deeperPages
      await firstPage
      if (token !== epoch) return
      loadedCombos.value = [...(recommendData.value?.combos ?? []), ...rest.flatMap(page => page.combos ?? [])]
      hasMore.value = rest[rest.length - 1]?.pagination?.hasMore ?? false
      // Self-correcting: a page that came back short (a filter narrowed the
      // field) must not leave `loadedPages` claiming pages that no longer exist.
      loadedPages.value = Math.max(1, Math.ceil(loadedCombos.value.length / pageSize))
      onResultsApplied?.()
    } catch {
      // A deeper page failed. Fall back to the first page rather than leave a
      // stale list up with nothing to say it is stale; `useRefetchNotice`
      // already covers the first page's own failures.
      if (token !== epoch) return
      loadedPages.value = 1
      loadedCombos.value = recommendData.value?.combos ?? []
      hasMore.value = recommendData.value?.pagination?.hasMore ?? false
    } finally {
      if (token === epoch) reloadingPages.value = false
    }
  }

  return { loadedCombos, hasMore, loadingMore, loadedPages, reloadingPages, showMore, refreshFirstPage, reloadLoadedPages }
}
