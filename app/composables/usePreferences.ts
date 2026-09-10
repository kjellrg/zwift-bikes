import type { BikeCategory } from '../../shared/types/catalog'
import { BIKE_CATEGORY_FILTERS } from '#shared/types/catalog'

const STORAGE_KEY = 'zwift-bikes:preferences'

/**
 * Small general-purpose UI preferences that should persist across visits
 * (as opposed to `useGarage`/`useRiderProfile`, which track "who you are"
 * data). Persisted to localStorage only.
 */
export function usePreferences() {
  const verifiedOnly = useState<boolean>('pref-verified-only', () => true)
  const myBikesOnly = useState<boolean>('pref-my-bikes-only', () => false)
  /**
   * Which bike category the route/segment pages rank by. Defaults to
   * `standard`, NOT `all`: TT frames win outright on most routes but are
   * restricted in a large share of organised events, so an all-categories
   * default answers a question most riders can't act on - and, because the
   * TT answer barely varies between routes, it also made ~150 route pages
   * give near-identical advice. The decision that actually depends on the
   * route (aero vs. lightweight, wheel class on rough surfaces) lives inside
   * `standard`. The genuinely fastest combo is never hidden: when it falls
   * outside this filter the pages surface it via the endpoints'
   * `fastestOverall` field.
   *
   * This default is also what web crawlers see. There is no localStorage at
   * render time, so a server-rendered pass always uses this initial value -
   * which is exactly why it must stay identical to the value a fresh client
   * ends up with after `load()` finds nothing. If the two ever diverge,
   * hydration flips the visible content and the rendered DOM stops matching
   * the prerendered HTML.
   */
  const bikeCategory = useState<BikeCategory | 'all'>('pref-bike-category', () => 'standard')
  /**
   * The category `persist()` writes: the rider's own choice, as last loaded
   * or set through `setBikeCategory`. `bikeCategory` itself can hold a
   * value a link supplied for the visit (`useSharedView` assigns the ref
   * directly, on purpose), and serialising the ref stored that value on the
   * next unrelated setter call - toggling Halo bikes after opening a
   * `?category=tt` link saved TT as the rider's category (issue #198). So
   * every setter persists this copy, and only `setBikeCategory` moves it.
   * Seeded from the ref so the default above stays the one place it is
   * written: a copy that drifted from it would report a link on every
   * fresh visit.
   */
  const storedBikeCategory = useState<BikeCategory | 'all'>('pref-bike-category-stored', () => bikeCategory.value)
  /** Whether the page shows a category a link supplied rather than the rider's own. */
  const categoryFromLink = computed(() => bikeCategory.value !== storedBikeCategory.value)
  /**
   * Storage is read once per app lifetime. Every control component and
   * `useRecommendRequest` call `load()` from their own `onMounted`, and a
   * repeat read is not the harmless no-op it looks like: it reassigns the
   * refs from storage, which would undo a link's category the moment a
   * lazily mounted control ran it. The first caller wins; the rest return.
   */
  const loaded = useState<boolean>('pref-loaded', () => false)
  /**
   * Whether the race-calendar teasers appear outside the events section: the
   * homepage's "Next race" card and the route pages' "Featured in upcoming
   * races" row. Defaults to on - the events pages themselves are always
   * reachable from the nav regardless. Same SSR rule as `bikeCategory`
   * above: the default is what a crawler and a fresh visitor both see, and
   * the teasers only ever appear post-mount anyway.
   */
  const showUpcomingRaces = useState<boolean>('pref-show-upcoming-races', () => true)
  /**
   * Whether the three purchasable Halo bikes (`PURCHASABLE_HALO_FRAMES` in
   * `classifyBikeFrame.ts`) appear in rankings. Defaults to off: each one
   * takes three fully upgraded frames of one brand plus ~20M Drops, so for
   * almost every rider they answer "what should I ride" with a bike they
   * can't select - the same reasoning as `bikeCategory`'s `standard` default.
   * And as there, nothing is silently hidden: a Halo bike that would win
   * still surfaces through the endpoints' `fastestOverall` disclosure, and
   * the filter is bypassed server-side for owned Halo frames and for
   * directed searches.
   *
   * Same SSR rule as `bikeCategory` above. This default deliberately
   * diverges from the ENDPOINTS' own default (absent `includeHalo` means
   * include, so the MCP tools and existing API consumers keep today's
   * behavior); the pages always send the param explicitly, so the two
   * defaults never meet.
   */
  const includeHaloBikes = useState<boolean>('pref-include-halo-bikes', () => false)

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      verifiedOnly: verifiedOnly.value,
      myBikesOnly: myBikesOnly.value,
      bikeCategory: storedBikeCategory.value,
      showUpcomingRaces: showUpcomingRaces.value,
      includeHaloBikes: includeHaloBikes.value
    }))
  }

  function load() {
    if (!import.meta.client || loaded.value) return
    loaded.value = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (typeof parsed.verifiedOnly === 'boolean') verifiedOnly.value = parsed.verifiedOnly
      if (typeof parsed.myBikesOnly === 'boolean') myBikesOnly.value = parsed.myBikesOnly
      // Validated against the one category list rather than trusted: a stale
      // or hand-edited value would otherwise reach the recommend endpoints
      // as a category no frame has - see `BIKE_CATEGORY_FILTERS`.
      if (typeof parsed.bikeCategory === 'string' && (BIKE_CATEGORY_FILTERS as readonly string[]).includes(parsed.bikeCategory)) {
        bikeCategory.value = parsed.bikeCategory as BikeCategory | 'all'
        storedBikeCategory.value = bikeCategory.value
      }
      if (typeof parsed.showUpcomingRaces === 'boolean') showUpcomingRaces.value = parsed.showUpcomingRaces
      if (typeof parsed.includeHaloBikes === 'boolean') includeHaloBikes.value = parsed.includeHaloBikes
    } catch {
      // ignore corrupted storage
    }
  }

  function setVerifiedOnly(value: boolean) {
    verifiedOnly.value = value
    persist()
  }

  function setMyBikesOnly(value: boolean) {
    myBikesOnly.value = value
    persist()
  }

  // No equality guard needed before assigning (unlike `useGarage.load()`,
  // which guards because its object refs hand watchers a fresh reference
  // every mount): this is a primitive, and Vue skips watchers on an
  // `Object.is`-equal assignment. That's what keeps a fresh visitor - and a
  // crawler - from firing a redundant recommend refetch right after
  // hydration. Don't mirror this into a second page-local ref.
  function setBikeCategory(value: BikeCategory | 'all') {
    bikeCategory.value = value
    storedBikeCategory.value = value
    persist()
  }

  /**
   * Drops a link's category in favour of the rider's own. Nothing to
   * persist: the stored copy is what comes back, so storage already holds
   * it. The assignment moves the ref only when a link changed it, and a
   * moved ref is what refetches the ranking.
   */
  function restoreBikeCategory() {
    bikeCategory.value = storedBikeCategory.value
  }

  function setShowUpcomingRaces(value: boolean) {
    showUpcomingRaces.value = value
    persist()
  }

  function setIncludeHaloBikes(value: boolean) {
    includeHaloBikes.value = value
    persist()
  }

  return { verifiedOnly, myBikesOnly, bikeCategory, categoryFromLink, showUpcomingRaces, includeHaloBikes, load, setVerifiedOnly, setMyBikesOnly, setBikeCategory, restoreBikeCategory, setShowUpcomingRaces, setIncludeHaloBikes }
}
