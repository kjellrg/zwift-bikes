/**
 * Gathers the "app context" block that rides along with a bug report - the
 * state a maintainer needs to reproduce what the rider was looking at.
 *
 * Everything here is read from state the app already holds; nothing is
 * measured, stored or sent by this composable. The rendered block is shown
 * verbatim in the report form before anything is handed off, which is the
 * same disclosure the About page already makes about what leaves the browser.
 *
 * Why these fields: a "this ranking is wrong" report is unreproducible
 * without the filters *and* the rider profile, because both change which
 * combos are scored and how (see `usePreferences` and `useRiderProfile`).
 * The profile is the only genuinely personal item in here, so it's opt-in and
 * defaults to off - a rider who doesn't tick it still sends a useful report,
 * just one that may need a follow-up question.
 */
export function useReportContext() {
  const route = useRoute()
  const colorMode = useColorMode()
  const config = useRuntimeConfig()
  const { bikeCategory, verifiedOnly, myBikesOnly, load: loadPreferences } = usePreferences()
  const { weightKg, heightCm, ftpWatts, wkg, draftMode, tttRiders, defaultUnownedLevel, load: loadProfile } = useRiderProfile()
  const { owned, ownedWheels, load: loadGarage } = useGarage()

  /** Opt-in, default off. Owned by the form; exposed so it can be a checkbox. */
  const includeProfile = ref(false)

  /**
   * Everything below reads browser-only state - `window`, `navigator`, and
   * localStorage-backed settings that aren't loaded during a server render.
   * Gating on this keeps the server-rendered markup and the client's first
   * render identical, so the block doesn't trip a hydration mismatch on
   * `/report` (which is prerendered) - the same rule the `bikeCategory`
   * default in `usePreferences` is written to satisfy.
   *
   * The `load()` calls are what make a report opened from `/report` itself
   * describe the rider's actual settings: the route and segment pages load
   * these on mount, but that page has no reason to, and an unloaded profile
   * would quietly report defaults as though the rider had chosen them.
   */
  const isReady = ref(false)
  onMounted(() => {
    loadPreferences()
    loadProfile()
    loadGarage()
    isReady.value = true
  })

  /**
   * Page identity. The full URL carries the query string, which matters for
   * segment pages specifically: their `?route=` param tailors the ranking, so
   * the same path with and without it are genuinely different results.
   */
  const pageUrl = computed(() =>
    isReady.value ? window.location.href : route.fullPath
  )

  const filters = computed(() =>
    `category=${bikeCategory.value}, verifiedOnly=${verifiedOnly.value}, myBikesOnly=${myBikesOnly.value}`
  )

  const profile = computed(() => {
    const base = `${weightKg.value} kg, ${heightCm.value} cm, ${ftpWatts.value} W `
      + `(${wkg.value.toFixed(2)} W/kg), unowned bikes assumed at level ${defaultUnownedLevel.value}`
    // Only spell out team size when it can actually affect the numbers.
    const draft = draftMode.value === 'ttt'
      ? `TTT, ${tttRiders.value} riders`
      : 'solo'
    return `${base}, draft=${draft}`
  })

  /**
   * Counts rather than contents: how *many* bikes are owned is what explains
   * a short results list under "only my garage", while the actual list would
   * bloat the report (and the URL budget in `report.ts`) without answering a
   * question anyone asked.
   */
  const garage = computed(() =>
    `${Object.keys(owned.value).length} frames, ${Object.keys(ownedWheels.value).length} wheelsets`
  )

  const browser = computed(() => {
    if (!isReady.value) return 'unknown'
    return `${navigator.userAgent} | ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x | ${colorMode.value}`
  })

  /**
   * Which build the rider was actually on. Falls back to 'unknown' when the
   * deploy didn't supply a commit - see `runtimeConfig.public.buildSha` in
   * nuxt.config.ts.
   */
  const build = computed(() => config.public.buildSha || 'unknown')

  /** The block exactly as it will be sent - what the form shows and copies. */
  const contextText = computed(() => {
    const lines = [
      `Page:     ${pageUrl.value}`,
      `Filters:  ${filters.value}`,
      `Build:    ${build.value}`,
      `Browser:  ${browser.value}`
    ]
    if (includeProfile.value) {
      lines.push(`Profile:  ${profile.value}`)
      lines.push(`Garage:   ${garage.value}`)
    }
    return lines.join('\n')
  })

  return { includeProfile, contextText, pageUrl }
}
