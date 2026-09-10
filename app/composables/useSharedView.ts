import type { Ref } from 'vue'
import { sharedViewFromQuery, sharedViewQueryPatch } from '../utils/sharedView'

/** The lap count on a page that ranks by one - a route page; a segment is ridden exactly once. */
export interface SharedViewLaps {
  laps: Ref<number>
  /**
   * The lap picker's ceiling, read when the link is applied (at mount)
   * rather than snapshotted at setup, so the page can call this anywhere in
   * its setup - before or after the route fetch the ceiling comes from.
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
 *   not overwrite the rider's saved category or draft mode. The composables
 *   keep that promise on their side too - they persist a stored copy of
 *   those two fields, never the ref, so an unrelated setter during the
 *   visit cannot store the link's value (issue #198), and they read storage
 *   only once, so a control mounting later cannot reassign the ref from it.
 *   `categoryFromLink` / `draftModeFromLink` report the divergence, and
 *   `restoreBikeCategory` / `restoreDraftMode` end it. Everything is
 *   assigned in one tick, so the view costs one request.
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
  const { bikeCategory, categoryFromLink } = usePreferences()
  const { draftMode, draftModeFromLink } = useRiderProfile()

  onMounted(() => {
    const view = sharedViewFromQuery(param, lapCount?.maxLaps())
    if (view.laps !== undefined && lapCount) lapCount.laps.value = view.laps
    if (view.bike !== undefined) {
      // Both refs, not just the box: the debounce exists to hold keystrokes
      // back, and a link's term is already settled. Seeding only `bikeSearch`
      // fetched the category and draft mode at once and the search 300 ms
      // later - two requests for one view. The debounce timer still fires
      // and finds the same value, which moves nothing.
      request.bikeSearch.value = view.bike
      request.bikeSearchDebounced.value = view.bike
    }
    if (view.category !== undefined) bikeCategory.value = view.category
    if (view.draft !== undefined) draftMode.value = view.draft

    // A link's value follows the rider to the next ranking page (see
    // **Shared view** in `CONTEXT.md`): the refs still hold it, but a
    // client-side navigation arrives with a clean query and the watcher
    // below only writes when a ref moves. So an override that is active and
    // missing from the URL is written now, and a reload of this page
    // reproduces it. Only link overrides: a stored non-default preference is
    // not written on load, as before - the rider's own choice keeps a clean
    // URL until a control moves. (A link carrying the hard default, say
    // `?category=standard` to a rider who stores `tt`, is carried here but
    // dropped by the next write, which cannot tell it from "nothing to
    // carry" - a link nobody can produce through the controls.)
    const carry: Record<string, string | undefined> = {}
    if (categoryFromLink.value && param('category') === undefined) carry.category = bikeCategory.value
    if (draftModeFromLink.value && param('draft') === undefined) carry.draft = draftMode.value
    if (Object.keys(carry).length) replaceQuery(carry)
  })

  watch(
    [() => lapCount?.laps.value, request.bikeSearchDebounced, bikeCategory, draftMode],
    ([laps, bike, category, draft]) => {
      replaceQuery(sharedViewQueryPatch({ laps, bike, category, draft }))
    }
  )
}
