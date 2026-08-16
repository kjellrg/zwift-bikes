import type { BikeCategory } from '../../shared/types/catalog'

const STORAGE_KEY = 'zwift-bikes:preferences'

/**
 * Everything `bikeCategory` is allowed to hold. Validated on `load()` rather
 * than trusted: a stale or hand-edited localStorage value would otherwise be
 * forwarded straight to the recommend endpoints as a category no frame has,
 * silently filtering every result away with no error anywhere.
 */
const BIKE_CATEGORY_VALUES = new Set<string>(['all', 'standard', 'tt', 'gravel', 'handbike', 'funbike'])

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
   * Whether the race-calendar teasers appear outside the events section: the
   * homepage's "Next race" card and the route pages' "Featured in upcoming
   * races" row. Defaults to on - the events pages themselves are always
   * reachable from the nav regardless. Same SSR rule as `bikeCategory`
   * above: the default is what a crawler and a fresh visitor both see, and
   * the teasers only ever appear post-mount anyway.
   */
  const showUpcomingRaces = useState<boolean>('pref-show-upcoming-races', () => true)

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      verifiedOnly: verifiedOnly.value,
      myBikesOnly: myBikesOnly.value,
      bikeCategory: bikeCategory.value,
      showUpcomingRaces: showUpcomingRaces.value
    }))
  }

  function load() {
    if (!import.meta.client) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (typeof parsed.verifiedOnly === 'boolean') verifiedOnly.value = parsed.verifiedOnly
      if (typeof parsed.myBikesOnly === 'boolean') myBikesOnly.value = parsed.myBikesOnly
      if (typeof parsed.bikeCategory === 'string' && BIKE_CATEGORY_VALUES.has(parsed.bikeCategory)) bikeCategory.value = parsed.bikeCategory as BikeCategory | 'all'
      if (typeof parsed.showUpcomingRaces === 'boolean') showUpcomingRaces.value = parsed.showUpcomingRaces
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
    persist()
  }

  function setShowUpcomingRaces(value: boolean) {
    showUpcomingRaces.value = value
    persist()
  }

  return { verifiedOnly, myBikesOnly, bikeCategory, showUpcomingRaces, load, setVerifiedOnly, setMyBikesOnly, setBikeCategory, setShowUpcomingRaces }
}
