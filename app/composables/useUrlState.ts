import type { LocationQueryRaw, RouteLocationNormalizedLoaded, Router } from 'vue-router'

/**
 * The per-visit knobs (laps, category, search, draft mode, the homepage
 * filters, a race's category group) live in the URL as well as in state, so
 * a results view can be shared and the back button restores it. Two rules
 * every page follows, and the reason this is shared rather than three copies:
 *
 * - **Read once, after mount.** Every page here is prerendered or SSR'd from
 *   the defaults; reading the query during render would put the shared HTML
 *   and the client's first render out of step (hydration mismatch). The
 *   values are untrusted input and are sanitised by the caller per key.
 * - **Write from state, never from the query.** A watcher on the committed
 *   refs calls `replaceQuery`; nothing watches `route.query` back into state,
 *   so a write can never re-trigger a read (the `useFetch` watchers on these
 *   pages would otherwise loop). Only non-default keys are written, so a
 *   default view keeps a clean URL, and unrelated params are left alone.
 *
 * `useCanonicalUrl` strips the query, so none of this touches canonical/OG
 * URLs.
 */
export function useUrlState(route: RouteLocationNormalizedLoaded, router: Router) {
  /** First value of a query param as a string, or undefined. */
  function param(key: string): string | undefined {
    const value = route.query[key]
    const first = Array.isArray(value) ? value[0] : value
    return typeof first === 'string' && first !== '' ? first : undefined
  }

  /** Integer param clamped to `[min, max]`, or undefined when absent/not a number. */
  function intParam(key: string, min: number, max: number): number | undefined {
    const raw = param(key)
    if (raw === undefined) return undefined
    const value = Number.parseInt(raw, 10)
    if (!Number.isFinite(value)) return undefined
    return Math.min(max, Math.max(min, value))
  }

  /** Param that must be one of `allowed`, else undefined. */
  function enumParam<T extends string>(key: string, allowed: readonly T[]): T | undefined {
    const raw = param(key)
    return raw !== undefined && (allowed as readonly string[]).includes(raw) ? raw as T : undefined
  }

  /**
   * Merges `patch` into the current query: a `undefined` value removes the
   * key, everything else is written as a string. No history entry - a
   * slider move is not a navigation.
   */
  function replaceQuery(patch: Record<string, string | number | undefined>) {
    const next: LocationQueryRaw = {}
    let changed = false
    for (const [key, value] of Object.entries(route.query)) {
      if (!(key in patch)) next[key] = value
    }
    for (const [key, value] of Object.entries(patch)) {
      const encoded = value === undefined ? undefined : String(value)
      if (param(key) !== encoded) changed = true
      if (encoded !== undefined) next[key] = encoded
    }
    if (changed) router.replace({ query: next })
  }

  return { param, intParam, enumParam, replaceQuery }
}
