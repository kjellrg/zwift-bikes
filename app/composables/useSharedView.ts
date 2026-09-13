import type { Ref } from 'vue'
import { sharedViewFromQuery, sharedViewQueryPatch, type SharedViewSelectionBounds, type SharedViewState } from '../utils/sharedView'

/**
 * What a page ranks by beyond the Ride's identity, where it has such a thing:
 * the lap count on a route, the Category group on a race, the Race format a
 * segment is ridden under. One page has at most one.
 */
export type SharedViewSelection<Value extends string = string>
  = | {
    /** The query key it rides under: `?laps=3`, `?group=1`. */
    key: 'laps' | 'group'
    value: Ref<number>
    /** The lowest selectable value, and the hard default: one lap, or the first category group. */
    min: number
    /**
     * The ceiling, read when the link is applied (at mount) rather than
     * snapshotted at setup, so the page can call this anywhere in its setup -
     * before or after the fetch the ceiling comes from.
     */
    max: () => number
  }
  | {
    /** `?rules=points` - see **Race format** in `CONTEXT.md`. */
    key: 'rules'
    /** `undefined` is the hard default here: the page is ridden as no race at all. */
    value: Ref<Value | undefined>
    /** Every format the control offers, so a link carrying anything else is dropped. */
    values: readonly Value[]
  }

/** How a selection reads out of a link: its ceiling is asked for here, at mount, not at setup. */
function selectionBounds<Value extends string>(selection: SharedViewSelection<Value>): SharedViewSelectionBounds {
  return selection.key === 'rules'
    ? { key: selection.key, values: selection.values }
    : { key: selection.key, min: selection.min, max: selection.max() }
}

/**
 * How a selection writes back into one. Read off the ref rather than taken
 * from the watcher's tuple, which flattens both shapes into one type and
 * would need a cast back out of it; the watcher still names the ref as a
 * source, so this runs on exactly the changes it used to.
 */
function selectionState<Value extends string>(selection: SharedViewSelection<Value>): SharedViewState['selection'] {
  return selection.key === 'rules'
    ? { key: selection.key, value: selection.value.value }
    : { key: selection.key, value: selection.value.value, min: selection.min }
}

/**
 * Carries a ranking page's shared view (see `CONTEXT.md`) in the URL:
 * `?laps=3&bike=tarmac&category=tt&draft=ttt`, or `?group=1&...` on a race.
 * The rules are in `app/utils/sharedView.ts`; this is the Nuxt side of them,
 * and it follows
 * `useUrlState`'s two rules, plus one carry of its own (below the read):
 * a value a link supplied on the previous ranking page is written into this
 * page's URL on mount when the URL lacks it, so the view lasts the visit.
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
 * and the selection come from the page because they are the page's own, not
 * stored.
 * Called after `useRecommendRequest`, so its `onMounted` runs after the
 * request's own `load()` calls.
 */
export function useSharedView<Value extends string = string>(
  request: Pick<ReturnType<typeof useRecommendRequest>, 'bikeSearch' | 'bikeSearchDebounced'>,
  selection?: SharedViewSelection<Value>
) {
  const { param, replaceQuery } = useUrlState(useRoute(), useRouter())
  const { bikeCategory, categoryFromLink } = usePreferences()
  const { draftMode, draftModeFromLink } = useRiderProfile()

  onMounted(() => {
    const view = sharedViewFromQuery(param, selection && selectionBounds(selection))
    // `sharedViewFromQuery` returns the shape the bounds it was handed ask for
    // - a clamped number for `laps`/`group`, one of `values` for `rules` -
    // which the single `SharedView` type cannot express, so each branch says
    // which it got rather than re-checking what is already checked.
    if (view.selection !== undefined && selection) {
      if (selection.key === 'rules') selection.value.value = view.selection as Value
      else selection.value.value = view.selection as number
    }
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
    [() => selection?.value.value, request.bikeSearchDebounced, bikeCategory, draftMode],
    ([, bike, category, draft]) => {
      replaceQuery(sharedViewQueryPatch({
        selection: selection && selectionState(selection),
        bike,
        category,
        draft
      }))
    }
  )
}
