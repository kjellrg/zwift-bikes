import type { Ref } from 'vue'
import { sharedViewFromQuery, sharedViewQueryPatch } from '../utils/sharedView'

/** The lap count on a page that ranks by one - a route page; a segment is ridden exactly once. */
export interface SharedViewLaps {
  laps: Ref<number>
  /**
   * The lap picker's ceiling, asked for at mount rather than passed as a
   * value: a route's ceiling is only known once its route has loaded.
   */
  maxLaps: () => number
}

/**
 * Carries a ranking page's shared view (see `CONTEXT.md`) in the URL:
 * `?laps=3&bike=tarmac&category=tt&draft=ttt`. The rules are in
 * `app/utils/sharedView.ts`; this is the Nuxt side of them, and it follows
 * `useUrlState`'s two rules:
 *
 * - **Read once, after mount.** By then the child controls' own `onMounted`
 *   has loaded the rider's stored preferences, so a value in the link wins
 *   over the stored one for this visit. Assigned to the state refs directly
 *   rather than through the setters on purpose: a link someone sent must
 *   not overwrite the rider's saved category or draft mode.
 * - **Write from state, never from the query.** A watcher on the committed
 *   refs - the settled search term, not the keystrokes - replaces the query
 *   with what `sharedViewQueryPatch` says is worth carrying.
 *
 * Reads `bikeCategory` and `draftMode` from their composables itself, the
 * way `useRecommendRequest` reaches the same stored state; the search refs
 * come from the page's request because they are the page's, not stored.
 * Called after `useRecommendRequest`, so its `onMounted` runs after the
 * request's own `load()` calls.
 */
export function useSharedView(
  request: Pick<ReturnType<typeof useRecommendRequest>, 'bikeSearch' | 'bikeSearchDebounced'>,
  lapCount?: SharedViewLaps
) {
  const { param, replaceQuery } = useUrlState(useRoute(), useRouter())
  const { bikeCategory } = usePreferences()
  const { draftMode } = useRiderProfile()

  onMounted(() => {
    const view = sharedViewFromQuery(param, lapCount?.maxLaps())
    if (view.laps !== undefined && lapCount) lapCount.laps.value = view.laps
    if (view.bike !== undefined) request.bikeSearch.value = view.bike
    if (view.category !== undefined) bikeCategory.value = view.category
    if (view.draft !== undefined) draftMode.value = view.draft
  })

  watch(
    [() => lapCount?.laps.value, request.bikeSearchDebounced, bikeCategory, draftMode],
    ([laps, bike, category, draft]) => {
      replaceQuery(sharedViewQueryPatch({ laps, bike, category, draft }))
    }
  )
}
