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
  laps?: number
  bike?: string
  category?: BikeCategory | 'all'
  draft?: DraftMode
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
 * The overrides a link's query applies for this visit. `maxLaps` is the lap
 * picker's ceiling on a page that has one (a route's, known only once its
 * route has loaded); a page without one ignores `?laps=` entirely. Unknown
 * enum values are dropped rather than mapped to a neighbour: a link carries
 * what someone saw, and a value nobody could have selected is a typo or a
 * probe, not a view.
 */
export function sharedViewFromQuery(param: QueryReader, maxLaps?: number): SharedView {
  const view: SharedView = {}
  // Clamped rather than dropped, unlike the enums below: a lap count past
  // the picker's ceiling is still a ride on this route, just a shorter one.
  if (maxLaps !== undefined) {
    const parsed = Number.parseInt(param('laps') ?? '', 10)
    if (Number.isFinite(parsed)) view.laps = Math.min(maxLaps, Math.max(1, parsed))
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

/** The committed state a page's shared view is written from. `laps` is absent on a page without a lap count. */
export interface SharedViewState {
  laps?: number
  bike: string
  category: BikeCategory | 'all'
  draft: DraftMode
}

/**
 * The query patch that carries `state` - for `useUrlState.replaceQuery`, so
 * `undefined` removes the key. Only non-default values are written, and
 * "default" means the HARD default (one lap, no search, `standard`, `solo`),
 * not the rider's stored preference: a rider with a saved `tt` category sees
 * `?category=tt`, which is exactly what makes their link reproduce their
 * view for someone whose stored category is something else. A page without
 * a lap count never touches `laps` at all, so an unrelated param of that
 * name is left alone.
 */
export function sharedViewQueryPatch(state: SharedViewState): Record<string, string | number | undefined> {
  const patch: Record<string, string | number | undefined> = {
    bike: state.bike || undefined,
    category: state.category !== 'standard' ? state.category : undefined,
    draft: state.draft !== 'solo' ? state.draft : undefined
  }
  if (state.laps !== undefined) patch.laps = state.laps > 1 ? state.laps : undefined
  return patch
}
