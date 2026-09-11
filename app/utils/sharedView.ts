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
  /** Only the keys the link carried are present. */
  selection?: number
  bike?: string
  category?: BikeCategory | 'all'
  draft?: DraftMode
}

/**
 * The query key a page's own selection rides under. A route ranks by lap
 * count, a race by which category group the rider is in; both are one bounded
 * integer, and neither belongs to the Ride's identity (see **Shared view** in
 * `CONTEXT.md`), which is what makes them the page's to carry.
 */
export type SharedViewSelectionKey = 'laps' | 'group'

/**
 * What a page's selection may be, for reading one out of a link. `min` is
 * load-bearing rather than always 1: laps are counted from one, while a
 * category group is an index into the race's groups and counts from zero.
 */
export interface SharedViewSelectionBounds {
  key: SharedViewSelectionKey
  min: number
  max: number
}

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
 * groups); a page without one ignores both selection keys entirely. Unknown
 * enum values are dropped rather than mapped to a neighbour: a link carries
 * what someone saw, and a value nobody could have selected is a typo or a
 * probe, not a view.
 */
export function sharedViewFromQuery(param: QueryReader, selection?: SharedViewSelectionBounds): SharedView {
  const view: SharedView = {}
  // Clamped rather than dropped, unlike the enums below: a lap count past the
  // picker's ceiling is still a ride on this route, just a shorter one, and a
  // group index past the last group still means "the last group".
  if (selection) {
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

/** The committed state a page's shared view is written from. `selection` is absent on a page that ranks by nothing of its own. */
export interface SharedViewState {
  selection?: { key: SharedViewSelectionKey, value: number, min: number }
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
 * for someone whose stored category is something else. A page without
 * a selection never touches `laps` or `group` at all, so an unrelated param
 * of either name is left alone.
 */
export function sharedViewQueryPatch(state: SharedViewState): Record<string, string | number | undefined> {
  const patch: Record<string, string | number | undefined> = {
    bike: state.bike || undefined,
    category: state.category !== 'standard' ? state.category : undefined,
    draft: state.draft !== 'solo' ? state.draft : undefined
  }
  if (state.selection) {
    const { key, value, min } = state.selection
    patch[key] = value > min ? value : undefined
  }
  return patch
}
