import type { BikeCategory } from '../../shared/types/catalog'
import type { DraftMode } from '../../shared/utils/physics/draft'
import { BIKE_CATEGORY_FILTERS } from '#shared/types/catalog'
import { DRAFT_MODES } from '#shared/utils/physics/draft'

/**
 * The values a link to a ranking page carries so the recipient sees what the
 * sender saw - see **Shared view** in `CONTEXT.md`. These are the Nuxt-free
 * rules: which query keys are honoured and how each is sanitised on the way
 * in, and which state values are worth writing on the way out. The reading
 * and writing themselves happen in `useSharedView`.
 */
export interface SharedView {
  /** Only the keys the link carried are present. Typed as its key's shape - see `SharedViewSelectionBounds`. */
  selection?: number | string
  bike?: string
  category?: BikeCategory | 'all'
  draft?: DraftMode
}

/**
 * The query key a page's own selection rides under, and one page has at most
 * one. A route ranks by lap count, a race by which category group the rider is
 * in, a segment by the Race format it is ridden under (see **Race format** in
 * `CONTEXT.md`). None of the three belongs to the Ride's identity, which is
 * what makes them the page's to carry rather than the URL's path.
 */
export type SharedViewSelectionKey = 'laps' | 'group' | 'rules'

/**
 * What a page's selection may be, for reading one out of a link: a bounded
 * integer, or one of a fixed set of words.
 *
 * For the integers, `min` is load-bearing rather than always 1 - laps are
 * counted from one, while a category group is an index into the race's groups
 * and counts from zero - and it doubles as the hard default, the value a
 * clean link omits.
 *
 * For `rules` there is no such floor: "not a race" is the absence of the key,
 * not one of its values, which is why `values` lists only the four real
 * formats and the hard default is simply `undefined`.
 */
export type SharedViewSelectionBounds
  = | { key: 'laps' | 'group', min: number, max: number }
    | { key: 'rules', values: readonly string[] }

/** First value of a query key as a string, or undefined when absent - `useUrlState.param`'s shape. */
export type QueryReader = (key: string) => string | undefined

/**
 * How much of a link's `?bike=` reaches the search box. Well inside the
 * endpoints' own 200-character `search` bound (`qSearch` in
 * `server/utils/apiQuerySchemas.ts`), so a link can never build a request the
 * API refuses, and far beyond any frame or wheel name - past this the value is
 * junk someone pasted, not a search.
 */
export const SHARED_VIEW_SEARCH_MAX_LENGTH = 100

/**
 * The overrides a link's query applies for this visit. `selection` is the
 * bounds of the page's own selection where it has one (a route's lap picker,
 * whose ceiling is known only once the route has loaded; a race's category
 * groups; a segment's race format); a page without one, or with a different
 * one, ignores every selection key entirely. Unknown enum values are dropped
 * rather than mapped to a neighbour: a link carries what someone saw, and a
 * value nobody could have selected is a typo or a probe, not a view.
 */
export function sharedViewFromQuery(param: QueryReader, selection?: SharedViewSelectionBounds): SharedView {
  const view: SharedView = {}
  if (selection && 'values' in selection) {
    // Dropped when unknown, like `category` and `draft` below and unlike the
    // integers in the other branch: a ranking under a format nobody could
    // have selected is not a view anybody saw.
    const raw = param(selection.key)
    if (raw !== undefined && selection.values.includes(raw)) view.selection = raw
  } else if (selection) {
    // Clamped rather than dropped, unlike every enum here: a lap count past
    // the picker's ceiling is still a ride on this route, just a shorter one,
    // and a group index past the last group still means "the last group".
    const parsed = Number.parseInt(param(selection.key) ?? '', 10)
    if (Number.isFinite(parsed)) view.selection = Math.min(selection.max, Math.max(selection.min, parsed))
  }
  const category = param('category')
  if (category !== undefined && (BIKE_CATEGORY_FILTERS as readonly string[]).includes(category)) {
    view.category = category as BikeCategory | 'all'
  }
  const bike = param('bike')
  if (bike) view.bike = bike.slice(0, SHARED_VIEW_SEARCH_MAX_LENGTH)
  const draft = param('draft')
  if (draft !== undefined && (DRAFT_MODES as readonly string[]).includes(draft)) view.draft = draft as DraftMode
  return view
}

/**
 * The committed state a page's shared view is written from. `selection` is
 * absent on a page that ranks by nothing of its own; on a `rules` page it is
 * present with a `value` of `undefined` while the page is ridden as no race,
 * which is what takes the key back out of the URL.
 */
export interface SharedViewState {
  selection?:
    | { key: 'laps' | 'group', value: number, min: number }
    | { key: 'rules', value: string | undefined }
  bike: string
  category: BikeCategory | 'all'
  draft: DraftMode
}

/**
 * The query patch that carries `state` - for `useUrlState.replaceQuery`, so
 * `undefined` removes the key. Only non-default values are written, and
 * "default" means the HARD default (the lowest selection, no search,
 * `standard`, `solo`), not the rider's stored preference: a rider with a
 * saved `tt` category sees
 * `?category=tt`, which is exactly what makes their link reproduce their view
 * for someone whose stored category is something else - and for `rules`,
 * whose hard default is having no format at all, `undefined` is both "not a
 * race" and "take the key out". A page without a selection never touches any
 * selection key, so an unrelated param of one of those names is left alone.
 */
export function sharedViewQueryPatch(state: SharedViewState): Record<string, string | number | undefined> {
  const patch: Record<string, string | number | undefined> = {
    bike: state.bike || undefined,
    category: state.category !== 'standard' ? state.category : undefined,
    draft: state.draft !== 'solo' ? state.draft : undefined
  }
  if (state.selection) {
    const selection = state.selection
    patch[selection.key] = selection.key === 'rules'
      ? selection.value
      : (selection.value > selection.min ? selection.value : undefined)
  }
  return patch
}
