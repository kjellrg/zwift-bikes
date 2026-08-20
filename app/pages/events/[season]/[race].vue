<script setup lang="ts">
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { geometryForRouteLaps } from '#shared/utils/physics/routeGeometry'

/**
 * One race. Everything a route page can't know lives here: the date, the
 * lap count for the rider's category group, and the equipment rules - Zwift
 * disables TT frames for points and scratch races, so a recommendation that
 * ignored the format would put an illegal bike at the top of the list.
 *
 * The recommendation data flow deliberately mirrors `pages/routes/[slug].vue`
 * (parallel fetches, `watch: false` on the recommend call, explicit refresh
 * on profile/garage/laps changes) so the two pages can't drift in behaviour.
 */
const route = useRoute()
const seasonSlug = computed(() => route.params.season as string)
const raceSlug = computed(() => route.params.race as string)

const season = getSeasonBySlug(seasonSlug.value)
const race = season ? getRaceBySlug(seasonSlug.value, raceSlug.value) : undefined
if (!season || !race || !isRacePublishable(race)) {
  throw createError({ statusCode: 404, statusMessage: 'Race not found', fatal: true })
}
const round = getRoundForRace(season, race)

const { owned, ownedWheels, load: loadGarage } = useGarage()
// Read-only plus `setDraftMode` (for the format hint below): the controls
// themselves live in `RiderProfileControls` / `BikeFilterControls`.
const { weightKg, heightCm, wkg, defaultUnownedLevel, draftMode, tttRiders, tttClimbWkg, setDraftMode, load: loadRiderProfile } = useRiderProfile()
const { verifiedOnly, myBikesOnly, bikeCategory, includeHaloBikes, setBikeCategory, setIncludeHaloBikes, load: loadPreferences } = usePreferences()

const bikeSearch = ref('')
const bikeSearchDebounced = ref('')
let bikeSearchDebounceTimer: ReturnType<typeof setTimeout> | undefined
watch(bikeSearch, (value) => {
  clearTimeout(bikeSearchDebounceTimer)
  bikeSearchDebounceTimer = setTimeout(() => {
    bikeSearchDebounced.value = value
  }, 300)
})
const pageSize = 9

// A/B and C/D routinely race the same route over a different number of laps,
// which changes the distance, the climbing and therefore the ranking - so the
// group is the page's primary control, not a footnote.
const categoryGroupIndex = ref(0)
const categoryGroupOptions = race.categories.map((group, index) => ({
  label: `${formatCategoryGroup(group)} - ${group.laps} lap${group.laps === 1 ? '' : 's'}`,
  value: index
}))
const selectedGroup = computed(() => categoryGroup(race!, categoryGroupIndex.value))
const laps = computed(() => lapsForCategoryGroup(race!, categoryGroupIndex.value))
/**
 * Undefined when the selected group races a route the catalog doesn't have -
 * ZRL runs C/D on an unlisted "exclusive" route in week 6. The page still shows
 * that group's published figures; it just can't rank bikes for it.
 */
const selectedRouteSlug = computed(() => selectedGroup.value?.routeSlug)
const ttAllowed = ttBikesAllowed(race)
const draftAllowed = draftingAllowed(race)
const formatLabel = computed(() => RACE_FORMAT_LABELS[race!.format!])
/**
 * The format for use mid-sentence. Every other format's label lowercases into
 * ordinary prose ("this is a points race"); "Race of Truth" is a proper name
 * and reads as gibberish if it doesn't keep its capitals.
 */
const formatPhrase = computed(() => race!.format === 'rot' ? 'Race of Truth' : formatLabel.value.toLowerCase())

/**
 * The persisted bike-category preference, made race-legal: a rider whose
 * stored category is `tt` opening a race where TT frames are outlawed is
 * ranked across all legal categories instead (matching the "All categories"
 * the hidden-TT select shows), WITHOUT overwriting their stored preference.
 */
const effectiveCategory = computed(() => {
  if (bikeCategory.value === 'all') return undefined
  if (bikeCategory.value === 'tt' && !ttAllowed) return undefined
  return bikeCategory.value
})

/**
 * The persisted draft mode, made race-legal - the exact counterpart of
 * `effectiveCategory` above, and for the same reason. WTRL switches drafting
 * off entirely in a Race of Truth, so a ranking computed at bunch speeds there
 * would be minutes fast and could genuinely reorder the list; it is forced to
 * solo instead. The rider's stored preference is left alone, because it still
 * applies to every other race they open.
 */
const effectiveDraftMode = computed(() => draftAllowed ? draftMode.value : 'solo')

const recommendQuery = computed(() => ({
  search: bikeSearchDebounced.value || undefined,
  category: effectiveCategory.value,
  limit: pageSize,
  offset: 0,
  // Always sent, never omitted - see the equivalent comment in `routes/[slug].vue`.
  verifiedOnly: verifiedOnly.value ? 'true' : 'false',
  // Always sent - the endpoint's default is include, the preference's is
  // exclude (see `usePreferences`).
  includeHalo: includeHaloBikes.value ? 'true' : 'false',
  ownedOnly: myBikesOnly.value ? 'true' : undefined,
  owned: Object.keys(owned.value).length ? JSON.stringify(owned.value) : undefined,
  ownedWheels: Object.keys(ownedWheels.value).length ? JSON.stringify(Object.keys(ownedWheels.value)) : undefined,
  defaultUnownedLevel: defaultUnownedLevel.value,
  weightKg: weightKg.value,
  heightCm: heightCm.value,
  wkg: wkg.value,
  laps: laps.value,
  // The whole point of an event page: rank only what the rider is allowed to
  // start on. See `excludeTT` in `server/api/recommend/[slug].get.ts`.
  excludeTT: ttAllowed ? undefined : 'true',
  // Omitted entirely in solo mode - see the equivalent comment in `routes/[slug].vue`.
  draftMode: effectiveDraftMode.value === 'solo' ? undefined : effectiveDraftMode.value,
  tttRiders: effectiveDraftMode.value === 'ttt' ? tttRiders.value : undefined,
  tttClimbWkg: effectiveDraftMode.value === 'ttt' ? tttClimbWkg.value : undefined
}))

// `useAsyncData` rather than `useFetch` here: the selected category group can
// change which route is being shown, and can have no route at all, which a
// `useFetch` URL can't express. Both are keyed on the slug so switching
// category fetches that group's route instead of reusing the previous one.
// The recommend call watches nothing itself (`watch: []` - `useAsyncData`'s
// spelling of `useFetch`'s `watch: false`) + the explicit refresh watcher
// below, matching the route/segment pages.
//
// The recommend key includes the serialized query, not just the slug. This
// mirrors what `useFetch` does implicitly on the route/segment pages (its
// auto-key hashes the query values) and it is load-bearing: while Nuxt is
// still hydrating, ANY `refresh()` - the manual one below included - is
// answered from the server-rendered payload for the current key instead of
// hitting the network (see `getDefaultCachedData` in Nuxt's `asyncData`).
// The rider's stored profile loads from localStorage inside that hydration
// window, so with a slug-only key the post-load refresh was silently
// swallowed and page one kept the default-profile times - while "Show more
// matches" fetched with the real profile, pinning faster times to the
// bottom of the list. A query change rolling the key over misses the
// payload cache, which is exactly what forces the refetch.
const [{ data: routeData }, { data: recommendData, status, refresh: refreshRecommendations, error: recommendError }] = await Promise.all([
  useAsyncData(
    () => `race-route-${selectedRouteSlug.value ?? 'none'}`,
    () => selectedRouteSlug.value ? $fetch(`/api/routes/${selectedRouteSlug.value}`) : Promise.resolve(null),
    { watch: [selectedRouteSlug] }
  ),
  useAsyncData(
    () => `race-recommend-${selectedRouteSlug.value ?? 'none'}-${JSON.stringify(recommendQuery.value)}`,
    () => selectedRouteSlug.value ? $fetch(`/api/recommend/${selectedRouteSlug.value}`, { query: recommendQuery.value }) : Promise.resolve(null),
    { watch: [] }
  )
])
useRefetchNotice(recommendError, status, refreshRecommendations)

onMounted(() => {
  loadGarage()
  // Normally the two control components load these themselves - but when the
  // selected group has no catalog route the controls aren't mounted at all,
  // and the query still wants the rider's stored profile. `load()` is an
  // idempotent localStorage read, so running it twice costs nothing.
  loadRiderProfile()
  loadPreferences()
})

const raceHeading = computed(() => raceDisplayName(race!))
const raceTitle = computed(() => `${season!.seriesName} ${season!.label} ${raceHeading.value}`)

const routeTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, laps.value) : undefined)
const climbOccurrences = computed(() => routeData.value ? expandClimbsForLaps(routeData.value, laps.value) : [])
const sprintOccurrences = computed(() => routeData.value ? expandSprintsForLaps(routeData.value, laps.value) : [])

/**
 * The organiser's published distance/elevation and this site's own totals
 * (lead-in plus laps of real route data) don't always agree - ZwiftInsider's
 * ZRacing figures run ~2 km over route data, consistent with an event-pen
 * lead-in. Both are shown when they differ rather than quietly picking one:
 * the official figure is what riders see in the event listing, and this
 * site's is what the physics below actually runs on.
 */
const officialDiffers = computed(() => {
  const group = selectedGroup.value
  if (!routeTotals.value || !group) return false
  const distanceOff = group.officialDistanceKm !== undefined
    && Math.abs(group.officialDistanceKm - routeTotals.value.distanceKm) >= 0.15
  const elevationOff = group.officialElevationM !== undefined
    && Math.abs(group.officialElevationM - routeTotals.value.elevationM) >= 5
  return distanceOff || elevationOff
})

/**
 * `useAsyncData` resolves to `null` when the selected group has no catalog
 * route; the route components take `undefined`. Normalised once here rather
 * than asserted at each of the half-dozen places they're used.
 */
const routeInfo = computed(() => routeData.value ?? undefined)

/**
 * Every distinct course in this race, in group order.
 *
 * Deliberately built from the race data rather than from the selected group,
 * so the title and meta description are the same whichever category is
 * selected - they describe the race, not the current toggle position. Without
 * this, a split race like Round 1 Week 3 advertised only A/B's course and
 * C/D's was invisible to search entirely.
 */
const allRouteNames = computed(() => [...new Set(race!.categories.map(group => group.routeName).filter((name): name is string => Boolean(name)))])
const routeNamesLabel = computed(() => allRouteNames.value.join(' & ') || 'Route TBC')
/** `A/B on Makuri 40, C/D on Urumaze` - only worth saying when they differ. */
const routeNamesByCategory = computed(() => race!.categories
  .map(group => `${formatCategoryGroup(group)} on ${group.routeName ?? 'a route to be confirmed'}`)
  .join(', '))

/** The route name to show, whether or not the catalog knows the route. */
const displayRouteName = computed(() => selectedGroup.value?.routeName ?? routeData.value?.name ?? 'Route TBC')

/** True when this group races somewhere the catalog can't rank bikes for. */
const groupHasNoRoute = computed(() => !selectedRouteSlug.value)

/** The per-group course comparison table earns its place only when the groups genuinely differ in route or laps. */
const coursesDiffer = hasSplitCourses(race)

/**
 * Powerups, as curated. Absent from the data = the organiser hasn't
 * published them = this whole block renders nothing at all (no placeholder);
 * `allowed: []` = explicitly no powerups, shown as a single badge.
 */
const powerups = race.powerups

/**
 * Same split as the FAQ's `rules` line: Zwift disables TT frames itself for
 * points and scratch races, while WTRL bans them by regulation in a Race of
 * Truth - where drafting being off would otherwise be the TT bike's whole
 * argument, so a rider is owed the reason rather than just the verdict.
 */
const ttAlertDescription = computed(() => {
  if (ttAllowed) return 'Zwift enables TT frames - and gives them draft - for team time trials, so they are included in the ranking below.'
  if (race!.format === 'rot') return 'Drafting is off in a Race of Truth, but WTRL still bans TT frames from it - so this is raced on road bikes, and they are the only thing ranked below.'
  return `Zwift disables TT frames for ${formatLabel.value.toLowerCase()}s, so they are excluded from the ranking below. Everything listed is a bike you can actually start on.`
})

/**
 * Where the points are, for the selected group.
 *
 * ZRL usually scores the same sprint both ways - FAL by finishing order
 * through it, FTS by elapsed time across it - so the two published lists are
 * merged into one row per segment rather than printed twice.
 */
const scoringSegments = computed(() => {
  const group = selectedGroup.value
  if (!group) return []
  const rows = new Map<string, { name: string, slug?: string, fal: number, fts: number }>()
  const add = (list: typeof group.falSegments, key: 'fal' | 'fts') => {
    for (const segment of list ?? []) {
      const row = rows.get(segment.name) ?? { name: segment.name, slug: segment.slug, fal: 0, fts: 0 }
      row[key] += segment.times ?? 1
      row.slug ??= segment.slug
      rows.set(segment.name, row)
    }
  }
  add(group.falSegments, 'fal')
  add(group.ftsSegments, 'fts')
  return [...rows.values()]
})

/**
 * A points race with nothing listed is a real, published state (three of
 * Round 1's do this) - worth saying out loud rather than rendering an empty
 * table that looks like a loading failure.
 */
/** The scoring segments that have a page here, for the elevation profile's stars. */
const scoringSlugs = computed(() => [...new Set(scoringSegments.value.map(segment => segment.slug).filter((slug): slug is string => Boolean(slug)))])

/**
 * Where each scoring segment actually falls along the ride, from the same
 * lap-expanded occurrences the profile and the climb/sprint cards use - so a
 * "2x" in the table and two starred markers on the profile are the same two
 * passes, not two independent derivations of the lap maths.
 *
 * Empty when zwift-data ships no segment placements for the route at all
 * (Urumaze is the case in Round 1), which the table handles by dropping the
 * column rather than printing a row of blanks.
 */
const scoringPositionsBySlug = computed(() => {
  const bySlug = new Map<string, number[]>()
  for (const occurrence of [...sprintOccurrences.value, ...climbOccurrences.value]) {
    if (!scoringSlugs.value.includes(occurrence.slug)) continue
    const positions = bySlug.get(occurrence.slug) ?? []
    positions.push(occurrence.rideFromKm)
    bySlug.set(occurrence.slug, positions)
  }
  for (const positions of bySlug.values()) positions.sort((a, b) => a - b)
  return bySlug
})

/**
 * The table's rows, in the order the rider meets them where that is knowable -
 * a points race is ridden in course order, not in the order the organiser
 * happened to list the segments. Segments with no position sort last, keeping
 * their published order among themselves.
 */
const scoringRows = computed(() => scoringSegments.value
  .map(segment => ({
    ...segment,
    positionsKm: segment.slug ? scoringPositionsBySlug.value.get(segment.slug) ?? [] : []
  }))
  .sort((a, b) => (a.positionsKm[0] ?? Infinity) - (b.positionsKm[0] ?? Infinity)))

const hasScoringPositions = computed(() => scoringRows.value.some(row => row.positionsKm.length))

const scoringSegmentsTbd = computed(() => Boolean(selectedGroup.value?.scoringSegmentsTbd))
const isPointsRaceWithoutSegments = computed(() => (race!.format === 'points' || race!.format === 'rot') && !scoringSegments.value.length)

/**
 * The race format contradicting the rider's persisted draft mode genuinely
 * reorders the fastest-bike list (a points race ranked at TTT paceline
 * speeds, or a TTT ranked solo), so it's worth a nudge - but never a silent
 * mutation: `draftMode` is a persisted preference, and the switch happens
 * only through the button's explicit `setDraftMode`.
 */
const draftHintDismissed = ref(false)
const draftHint = computed(() => {
  // Nothing to nudge towards when the race has no draft at all: the ranking is
  // already forced solo, and the banner that says so replaces this entirely.
  if (!draftAllowed) return undefined
  if (draftHintDismissed.value) return undefined
  if (race!.format === 'ttt' && draftMode.value !== 'ttt') {
    return {
      text: 'This is a team time trial, but the ranking below is computed for ' + (draftMode.value === 'race' ? 'a mass-start bunch' : 'a solo rider') + '. TTT draft mode ranks bikes at your team\'s paceline speeds instead - and it can genuinely reorder the list.',
      action: 'Use TTT draft mode',
      mode: 'ttt' as const
    }
  }
  // A points or scratch race IS a mass start, so race draft mode is the honest
  // default here - both for a rider who left TTT on and for one still on solo,
  // whose predicted time is then minutes off what a bunch actually does.
  if (race!.format !== 'ttt' && draftMode.value !== 'race') {
    return {
      text: draftMode.value === 'ttt'
        ? `Your profile has TTT draft mode on, but this is a ${formatPhrase.value} - the ranking below assumes paceline speeds this race won't be ridden at. Race draft mode models the mass-start bunch this actually is.`
        : `This is a ${formatPhrase.value}, but the ranking below is computed for a lone rider with no draft at all. Race draft mode adds the draft a typical mid-pack racer measurably gets, calibrated on thirteen real race fields.`,
      action: 'Use race draft mode',
      mode: 'race' as const
    }
  }
  return undefined
})

/** Whatever `/api/recommend/[slug]` returns, kept in step with it by inference. */
type ComboResult = NonNullable<typeof recommendData.value>['combos'][number]

const loadedCombos = ref<ComboResult[]>([])
const hasMore = ref(true)
const loadingMore = ref(false)
// Same lagged-laps rule as `routes/[slug].vue`: a speed readout must divide a
// distance by a finish time computed for the SAME lap count, so the value the
// cards and FAQ use only advances when results for it actually arrive.
const resultsLaps = ref(laps.value)
watch(recommendData, (data) => {
  if (!data) {
    // Selecting a group with no catalog route clears the list rather than
    // leaving the previous group's ranking sitting under the wrong heading.
    loadedCombos.value = []
    hasMore.value = false
    return
  }
  loadedCombos.value = data.combos ?? []
  hasMore.value = data.pagination?.hasMore ?? false
  resultsLaps.value = laps.value
}, { immediate: true })
const resultsTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, resultsLaps.value) : undefined)

// Whether the team climb pace control is worth showing - see the
// `hasLongClimb` prop on `RiderProfileControls`. Keyed on the rider's NORMAL
// power, never on `tttClimbWkg`, so the climb pace can't decide its own
// slider's visibility.
const hasLongClimb = computed(() => routeData.value
  ? detectLongClimbBlocks(geometryForRouteLaps(routeData.value, resultsLaps.value), wkg.value * weightKg.value, weightKg.value).length > 0
  : true)

const isFirstLoad = computed(() => status.value === 'pending' && !recommendData.value)
const isRefreshingCombos = computed(() => status.value === 'pending' && !!recommendData.value)

async function showMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    if (!selectedRouteSlug.value) return
    const nextPage = await $fetch(`/api/recommend/${selectedRouteSlug.value}`, {
      query: { ...recommendQuery.value, offset: loadedCombos.value.length, limit: pageSize }
    })
    loadedCombos.value = [...loadedCombos.value, ...(nextPage.combos ?? [])]
    hasMore.value = nextPage.pagination?.hasMore ?? false
  } finally {
    loadingMore.value = false
  }
}

watch([weightKg, heightCm, wkg, laps, selectedRouteSlug, myBikesOnly, verifiedOnly, includeHaloBikes, bikeCategory, bikeSearchDebounced, effectiveDraftMode, tttRiders, tttClimbWkg], () => {
  refreshRecommendations()
})
watch(owned, () => {
  refreshRecommendations()
}, { deep: true })
watch(ownedWheels, () => {
  refreshRecommendations()
}, { deep: true })

const combos = computed(() => loadedCombos.value)
const topCombo = computed(() => combos.value[0])
const restCombos = computed(() => combos.value.slice(1))
const fastestTimeSec = computed(() => {
  const times = combos.value.map(c => c.finishTimeSec).filter((t): t is number => typeof t === 'number')
  return times.length ? Math.min(...times) : undefined
})
const physicsInfo = computed(() => recommendData.value?.physics)
// Present only when the category filter is hiding a faster combo - and the
// `excludeTT` pool means it can never advertise a bike that's illegal here.
const fastestOverall = computed(() => recommendData.value?.fastestOverall)

/** Only meaningful once the race window has closed - resolved client-side, see below. */
const isPast = ref(false)
onMounted(() => {
  isPast.value = raceEndDate(race!) < new Date().toISOString().slice(0, 10)
})

const faqQuestion = computed(() => `What bike should I ride for ${raceTitle.value}?`)
const faqAnswer = computed(() => {
  if (!routeData.value || !topCombo.value || typeof topCombo.value.finishTimeSec !== 'number') return undefined
  const equipment = topCombo.value.wheelset
    ? `${topCombo.value.frame.name} with ${topCombo.value.wheelset.name}`
    : topCombo.value.frame.name
  const distanceKm = resultsTotals.value?.distanceKm ?? routeData.value.distance
  // Who does the disabling differs and it matters to a rider reading the rules:
  // Zwift itself blocks TT frames in points and scratch races, whereas WTRL
  // bans them by regulation in a Race of Truth.
  const rules = ttAllowed
    ? 'TT bikes are allowed in this team time trial'
    : race!.format === 'rot'
      ? 'WTRL bans TT bikes from its Race of Truth'
      : `TT bikes are disabled for this ${formatPhrase.value}`
  const draftRule = draftAllowed ? '' : ', and WTRL turns drafting off, so the time below is ridden solo'
  return `${rules}${draftRule}. Over ${resultsLaps.value} lap${resultsLaps.value === 1 ? '' : 's'} of ${routeData.value.name} (${formatDistance(distanceKm)}), our physics model makes the ${equipment} the fastest legal combo, finishing in ${formatDuration(topCombo.value.finishTimeSec)} (~${formatSpeedKmh(distanceKm, topCombo.value.finishTimeSec)}).`
})

const siteConfig = useSiteConfig()
const canonicalUrl = useCanonicalUrl()

useSeoMeta({
  title: () => `Best Bike for ${season!.seriesName} ${raceHeading.value} - ${routeNamesLabel.value} (${formatLabel.value}) - ZwiftBikes`,
  description: () => hasSplitCourses(race!)
    ? `${raceTitle.value}: ${formatLabel.value} on ${formatRaceDate(race!.date)} - ${routeNamesByCategory.value}. Lap counts per category, TT bike rules, and the fastest legal bike and wheel combo for each course.`
    : `${raceTitle.value}: ${formatLabel.value} on ${routeNamesLabel.value}, ${formatRaceDate(race!.date)}. Lap counts per category, TT bike rules, and the fastest legal bike and wheel combo.`,
  ogTitle: () => `${raceHeading.value} - ${routeNamesLabel.value}`,
  ogDescription: () => hasSplitCourses(race!)
    ? `The fastest legal bike and wheel combo for ${raceTitle.value} - ${routeNamesByCategory.value}.`
    : `The fastest legal bike and wheel combo for ${raceTitle.value} on ${routeNamesLabel.value}.`,
  ogImage: () => routeData.value ? getWorldImageUrl(routeData.value.world) : undefined,
  twitterImage: () => routeData.value ? getWorldImageUrl(routeData.value.world) : undefined
})

useHead(() => {
  if (!routeData.value) return {}
  const scripts = [
    {
      type: 'application/ld+json' as const,
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
          { '@type': 'ListItem', 'position': 2, 'name': 'Race calendars', 'item': `${siteConfig.url}/events` },
          { '@type': 'ListItem', 'position': 3, 'name': `${season!.seriesName} ${season!.label}`, 'item': `${siteConfig.url}/events/${season!.slug}` },
          { '@type': 'ListItem', 'position': 4, 'name': raceHeading.value, 'item': canonicalUrl.value }
        ]
      }).replace(/</g, '\\u003c')
    },
    {
      // A real, dated, registerable online race - so `SportsEvent` with a
      // `VirtualLocation` rather than a generic `Event`. `superEvent` ties the
      // week back to its season the way the breadcrumb ties the page back to
      // the calendar.
      type: 'application/ld+json' as const,
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SportsEvent',
        'name': `${raceTitle.value} - ${routeNamesLabel.value}`,
        'description': hasSplitCourses(race!)
          ? `${formatLabel.value} - ${routeNamesByCategory.value}.`
          : `${formatLabel.value} on ${routeNamesLabel.value} in ${routeData.value.worldName}.`,
        'startDate': race!.date,
        ...(race!.endDate ? { endDate: race!.endDate } : {}),
        'sport': 'Cycling',
        'eventAttendanceMode': 'https://schema.org/OnlineEventAttendanceMode',
        'eventStatus': 'https://schema.org/EventScheduled',
        'location': {
          '@type': 'VirtualLocation',
          'name': `Zwift - ${routeData.value.worldName}`,
          'url': 'https://www.zwift.com'
        },
        'organizer': {
          '@type': 'Organization',
          'name': season!.organizer,
          ...(season!.organizerUrl ? { url: season!.organizerUrl } : {})
        },
        'superEvent': {
          '@type': 'SportsEvent',
          'name': `${season!.seriesName} ${season!.label}`,
          'url': `${siteConfig.url}/events/${season!.slug}`
        },
        'url': canonicalUrl.value
      }).replace(/</g, '\\u003c')
    }
  ]
  if (faqAnswer.value) {
    scripts.push({
      type: 'application/ld+json' as const,
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        'mainEntity': [{
          '@type': 'Question',
          'name': faqQuestion.value,
          'acceptedAnswer': { '@type': 'Answer', 'text': faqAnswer.value }
        }]
      }).replace(/</g, '\\u003c')
    })
  }
  return { script: scripts }
})
</script>

<template>
  <UContainer class="py-10 space-y-10">
    <div>
      <UButton
        :to="`/events/${season!.slug}`"
        variant="link"
        color="neutral"
        icon="i-lucide-arrow-left"
        class="mb-4 px-0"
      >
        {{ season!.seriesName }} {{ season!.label }} schedule
      </UButton>
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p class="text-sm text-muted">
            {{ season!.seriesName }} {{ season!.label }}<template v-if="round?.name">
              - {{ round.name }}
            </template>
          </p>
          <h1 class="text-3xl font-bold text-highlighted">
            {{ raceHeading }}: {{ displayRouteName }}
          </h1>
          <p class="text-muted">
            <template v-if="race!.endDate">
              {{ formatRaceDateRange(race!.date, race!.endDate) }}
            </template>
            <template v-else>
              {{ formatRaceDate(race!.date) }}
            </template>
            <template v-if="routeData">
              - {{ routeData.worldName }}
            </template>
          </p>
          <p
            v-if="race!.sourceUrl || season!.organizerUrl"
            class="text-sm mt-1"
          >
            <ULink
              :to="race!.sourceUrl ?? season!.organizerUrl"
              target="_blank"
              rel="noopener"
              class="text-primary underline"
            >Official event info</ULink>
            <span class="text-muted"> - signup, full rules and results live with {{ season!.organizer }}; we rank the bikes.</span>
          </p>
        </div>
        <div class="flex flex-wrap sm:justify-end gap-2">
          <UBadge
            :color="RACE_FORMAT_COLORS[race!.format!]"
            variant="subtle"
          >
            {{ formatLabel }}
          </UBadge>
          <UBadge
            v-if="isPast"
            color="neutral"
            variant="subtle"
          >
            Completed
          </UBadge>
          <template v-if="routeData">
            <TerrainBadge :terrain="routeData.terrain" />
            <SurfaceBadges :surface="routeData.surface" />
          </template>
        </div>
      </div>

      <UAlert
        class="mt-6"
        :color="ttAllowed ? 'warning' : 'info'"
        variant="subtle"
        :icon="ttAllowed ? 'i-lucide-rocket' : 'i-lucide-ban'"
        :title="ttAllowed ? 'TT bikes are allowed in this race' : 'TT bikes are disabled for this race'"
        :description="ttAlertDescription"
      />

      <!--
        Not a nudge like the draft hint below it, but a rule: the ranking is
        already computed solo whatever the rider's saved draft mode says, so
        this states what happened rather than offering to change it - and is
        deliberately not dismissible for that reason.
      -->
      <UAlert
        v-if="!draftAllowed"
        class="mt-4"
        color="error"
        variant="subtle"
        icon="i-lucide-wind"
        title="Drafting is disabled in this race"
        description="WTRL turns the draft off for a Race of Truth: there is no bunch to sit in, so every rider covers the course on their own power. The ranking below is computed solo for exactly that reason, and aerodynamics count for more here than in a normal road race. Your saved draft setting is untouched and still applies everywhere else."
      />

      <!-- The differences readable at a glance, without toggling the selector. -->
      <div
        v-if="coursesDiffer"
        class="mt-6 overflow-x-auto rounded-lg border border-default"
      >
        <table class="w-full text-sm">
          <thead class="bg-elevated/50">
            <tr class="text-left text-muted">
              <th class="px-4 py-2 font-medium">
                Category
              </th>
              <th class="px-4 py-2 font-medium">
                Course
              </th>
              <th class="px-4 py-2 font-medium">
                Laps
              </th>
              <th class="px-4 py-2 font-medium">
                Distance
              </th>
              <th class="px-4 py-2 font-medium">
                Elevation
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="group in race!.categories"
              :key="formatCategoryGroup(group)"
              class="border-t border-default"
            >
              <td class="px-4 py-2 whitespace-nowrap font-medium text-highlighted">
                {{ formatCategoryGroup(group) }}
              </td>
              <td class="px-4 py-2">
                {{ group.routeName ?? 'TBC' }}
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                {{ group.laps }}
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                <template v-if="group.officialDistanceKm">
                  {{ formatDistance(group.officialDistanceKm) }}
                </template>
                <span
                  v-else
                  class="text-muted"
                >-</span>
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                <template v-if="group.officialElevationM !== undefined">
                  {{ formatElevation(group.officialElevationM) }}
                </template>
                <span
                  v-else
                  class="text-muted"
                >-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="categoryGroupOptions.length > 1"
        class="mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-default p-4"
      >
        <div class="w-56">
          <label class="block text-xs font-medium text-muted mb-1">Your category</label>
          <USelectMenu
            v-model="categoryGroupIndex"
            value-key="value"
            :items="categoryGroupOptions"
            :search-input="false"
          />
        </div>
        <p class="text-sm text-muted">
          The stats, segments and bike ranking below all follow this.
        </p>
      </div>

      <div class="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Distance
          </p>
          <p class="text-xl font-bold">
            {{ formatDistance(routeTotals?.distanceKm ?? selectedGroup?.officialDistanceKm ?? 0) }}
          </p>
        </UCard>
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Elevation
          </p>
          <p class="text-xl font-bold">
            {{ formatElevation(routeTotals?.elevationM ?? selectedGroup?.officialElevationM ?? 0) }}
          </p>
        </UCard>
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Laps
          </p>
          <p class="text-xl font-bold">
            {{ laps }}
          </p>
        </UCard>
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Terrain
          </p>
          <p class="text-xl font-bold">
            {{ routeData ? TERRAIN_LABELS[routeData.terrain.category] : '-' }}
          </p>
        </UCard>
      </div>

      <p
        v-if="officialDiffers"
        class="mt-3 text-xs text-muted"
      >
        {{ season!.organizer }} publishes this race as
        <template v-if="selectedGroup?.officialDistanceKm">
          {{ formatDistance(selectedGroup.officialDistanceKm) }}
        </template>
        <template v-if="selectedGroup?.officialDistanceKm && selectedGroup?.officialElevationM">
          /
        </template>
        <template v-if="selectedGroup?.officialElevationM">
          {{ formatElevation(selectedGroup.officialElevationM) }}
        </template>.
        The figures above are this site's own totals from the route's lead-in and lap data, which is
        what the physics model below runs on.
      </p>

      <!-- Curated fact only: absent powerup data renders nothing at all. -->
      <div
        v-if="powerups"
        class="mt-4 flex flex-wrap items-center gap-2"
      >
        <span class="text-sm font-medium text-highlighted">PowerUps:</span>
        <template v-if="powerups.allowed.length">
          <UBadge
            v-for="powerup in powerups.allowed"
            :key="powerup"
            color="primary"
            variant="subtle"
            :icon="POWERUP_ICONS[powerup]"
          >
            {{ POWERUP_LABELS[powerup] }}
          </UBadge>
        </template>
        <UBadge
          v-else
          color="neutral"
          variant="subtle"
          icon="i-lucide-ban"
        >
          No powerups
        </UBadge>
        <span
          v-if="powerups.note"
          class="text-xs text-muted"
        >{{ powerups.note }}</span>
      </div>
    </div>

    <div
      v-if="race!.note"
      class="rounded-lg border border-default p-4"
    >
      <h2 class="text-lg font-semibold text-highlighted mb-2">
        How this race tends to play out
      </h2>
      <p class="text-muted">
        {{ race!.note }}
      </p>
      <p
        v-if="race!.sourceUrl"
        class="text-xs text-muted mt-2"
      >
        Race details from
        <ULink
          :to="race!.sourceUrl"
          target="_blank"
          rel="noopener"
          class="text-primary underline"
        >the published round guide</ULink>.
      </p>
    </div>

    <div v-if="scoringSegments.length || isPointsRaceWithoutSegments || scoringSegmentsTbd">
      <h2 class="text-lg font-semibold text-highlighted mb-2">
        Where the points are
      </h2>
      <p
        v-if="scoringSegmentsTbd"
        class="text-muted"
      >
        <UBadge
          color="neutral"
          variant="subtle"
          class="mr-1.5"
        >
          TBD
        </UBadge>
        {{ season!.organizer }} hasn't published the scoring segments for this race yet. They're
        added here as soon as they appear.
      </p>
      <p
        v-else-if="isPointsRaceWithoutSegments"
        class="text-muted"
      >
        {{ season!.organizer }} lists no intermediate scoring segments for this race.
      </p>
      <template v-else-if="scoringSegments.length">
        <p class="text-muted mb-3">
          Points are scored at these segments - <span class="font-medium text-highlighted">FAL</span> by the
          order riders cross the line, <span class="font-medium text-highlighted">FTS</span> by elapsed time
          across the segment. Tap a segment to see the fastest bikes for that sprint alone - the
          fastest bike for a sprint isn't always the fastest over the whole race.<template v-if="hasScoringPositions">
            Every scoring pass is starred on the elevation profile below, in the order you meet it.
          </template>
        </p>
        <div class="overflow-x-auto rounded-lg border border-default">
          <table class="w-full text-sm">
            <thead class="bg-elevated/50">
              <tr class="text-left text-muted">
                <th class="px-4 py-2 font-medium">
                  Segment
                </th>
                <th class="px-4 py-2 font-medium">
                  FAL
                </th>
                <th class="px-4 py-2 font-medium">
                  FTS
                </th>
                <!-- Only when the route publishes where its segments sit - see
                     `scoringPositionsBySlug`. -->
                <th
                  v-if="hasScoringPositions"
                  class="px-4 py-2 font-medium"
                >
                  Comes at
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="segment in scoringRows"
                :key="segment.name"
                class="border-t border-default"
              >
                <td class="px-4 py-2">
                  <!-- Linked only when the segment has a page here. -->
                  <ULink
                    v-if="segment.slug"
                    :to="`/segments/${segment.slug}?route=${selectedRouteSlug}`"
                    class="text-primary underline"
                  >{{ segment.name }}</ULink>
                  <template v-else>
                    {{ segment.name }}
                  </template>
                </td>
                <td class="px-4 py-2 whitespace-nowrap">
                  <span v-if="segment.fal">{{ segment.fal }}x</span>
                  <span
                    v-else
                    class="text-muted"
                  >-</span>
                </td>
                <td class="px-4 py-2 whitespace-nowrap">
                  <span v-if="segment.fts">{{ segment.fts }}x</span>
                  <span
                    v-else
                    class="text-muted"
                  >-</span>
                </td>
                <td
                  v-if="hasScoringPositions"
                  class="px-4 py-2 whitespace-nowrap"
                >
                  <span v-if="segment.positionsKm.length">{{ segment.positionsKm.map(km => formatDistance(km)).join(', ') }}</span>
                  <span
                    v-else
                    class="text-muted"
                  >-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p
          v-if="scoringSegments.some(segment => !segment.slug)"
          class="text-xs text-muted mt-2"
        >
          Segments without a link aren't in this site's segment catalog yet - it's built from routes
          that publish where each segment sits along them, and this one doesn't.
        </p>
      </template>
    </div>

    <div v-if="faqAnswer">
      <h2 class="text-lg font-semibold text-highlighted mb-2">
        {{ faqQuestion }}
      </h2>
      <p class="text-muted">
        {{ faqAnswer }}
      </p>
    </div>

    <RouteSurfaceSpeedProfile
      v-if="topCombo && routeInfo"
      :route="routeInfo"
      :frame="topCombo.frame"
      :wheelset="topCombo.wheelset"
      :weight-kg="weightKg"
      :height-cm="heightCm"
      :wkg="wkg"
      :draft-mode="effectiveDraftMode"
      :ttt-riders="tttRiders"
      :ttt-climb-wkg="tttClimbWkg"
    />

    <div v-if="routeInfo?.terrain.elevationProfile && routeInfo.terrain.elevationProfile.length > 1">
      <RouteElevationProfile
        :route="routeInfo"
        :laps="laps"
        :climbs="climbOccurrences"
        :sprints="sprintOccurrences"
        :scoring-slugs="scoringSlugs"
      />
    </div>

    <div
      v-if="routeData && (climbOccurrences.length || sprintOccurrences.length || routeData.surface.composition)"
      class="grid grid-cols-1 lg:grid-cols-3 gap-6"
    >
      <div
        v-if="climbOccurrences.length || sprintOccurrences.length"
        class="lg:col-span-2 space-y-6"
      >
        <div v-if="climbOccurrences.length">
          <h2 class="text-lg font-semibold text-highlighted mb-3">
            Climbs in this race
          </h2>
          <RouteClimbs
            :climbs="climbOccurrences"
            :route-slug="routeInfo!.slug"
          />
        </div>
        <div v-if="sprintOccurrences.length">
          <h2 class="text-lg font-semibold text-highlighted mb-3">
            Sprints in this race
          </h2>
          <RouteSprints
            :sprints="sprintOccurrences"
            :route-slug="routeInfo!.slug"
          />
        </div>
      </div>
      <div v-if="routeInfo!.surface.composition">
        <h2 class="text-lg font-semibold text-highlighted mb-3">
          Surface
        </h2>
        <RouteSurfaceComposition :surface="routeInfo!.surface" />
      </div>
    </div>

    <PhysicsNote
      v-if="physicsInfo"
      :mode="physicsInfo.mode"
      :summary="physicsInfo.summary"
      :note="physicsInfo.note"
    />

    <div>
      <h2 class="text-xl font-semibold text-highlighted mb-4">
        Best bike &amp; wheel combo for this race
      </h2>

      <UAlert
        v-if="groupHasNoRoute"
        color="neutral"
        variant="subtle"
        icon="i-lucide-map-pin-off"
        :title="`${displayRouteName} isn't in the public route catalog`"
        :description="`${season!.organizer} runs ${formatCategoryGroup(selectedGroup ?? { cats: [] })} on an event-exclusive route we have no data for, so there is no distance, elevation or surface to simulate against - and a ranking computed from a guess would be worse than none. The published figures above are ${season!.organizer}'s own. Pick another category above to see recommendations for the routes we do have.`"
      />

      <template v-else>
        <div
          v-if="draftHint"
          class="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-default p-4"
        >
          <UIcon
            name="i-lucide-users"
            class="size-5 text-warning shrink-0"
          />
          <p class="flex-1 min-w-64 text-sm text-muted">
            {{ draftHint.text }}
          </p>
          <UButton
            size="xs"
            color="warning"
            variant="subtle"
            @click="setDraftMode(draftHint.mode)"
          >
            {{ draftHint.action }}
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="Dismiss draft mode hint"
            @click="draftHintDismissed = true"
          />
        </div>

        <BikeFilterControls
          v-model:search="bikeSearch"
          :hide-tt-category="!ttAllowed"
          class="mb-6"
        />

        <RiderProfileControls
          :has-long-climb="hasLongClimb"
          :draft-locked="!draftAllowed"
          class="mb-6"
        />

        <div
          v-if="isFirstLoad"
          class="space-y-4"
        >
          <ComboResultCardSkeleton class="mb-6" />
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ComboResultCardSkeleton />
            <ComboResultCardSkeleton />
          </div>
        </div>
        <template v-else>
          <p
            v-if="isRefreshingCombos"
            class="flex items-center gap-1.5 text-sm text-muted mb-3"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-4 animate-spin"
            />Updating results…
          </p>
          <FastestOverallNote
            v-if="fastestOverall"
            :fastest-overall="fastestOverall"
            @show-all="setBikeCategory('all')"
            @include-halo="setIncludeHaloBikes(true)"
          />
          <div
            class="transition-opacity"
            :class="{ 'opacity-60 pointer-events-none': isRefreshingCombos }"
          >
            <ComboResultCard
              v-if="topCombo"
              :combo="topCombo"
              :rank="1"
              :route="routeInfo"
              :weight-kg="weightKg"
              :height-cm="heightCm"
              :wkg="wkg"
              :laps="resultsLaps"
              :fastest-time-sec="fastestTimeSec"
              :owned="owned"
              :draft-mode="effectiveDraftMode"
              :ttt-riders="tttRiders"
              :ttt-climb-wkg="tttClimbWkg"
              class="mb-6"
            />
            <div
              v-if="restCombos.length"
              class="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              <ComboResultCard
                v-for="(combo, index) in restCombos"
                :key="`${combo.frame.id}-${combo.wheelset?.key ?? 'fixed'}`"
                :combo="combo"
                :rank="index + 2"
                :route="routeInfo"
                :weight-kg="weightKg"
                :height-cm="heightCm"
                :wkg="wkg"
                :laps="resultsLaps"
                :fastest-time-sec="fastestTimeSec"
                :owned="owned"
                :draft-mode="effectiveDraftMode"
                :ttt-riders="tttRiders"
                :ttt-climb-wkg="tttClimbWkg"
              />
            </div>
            <p
              v-else-if="!topCombo"
              class="text-muted text-center py-10"
            >
              No bikes match your filters.
            </p>
          </div>
          <div
            v-if="hasMore"
            class="text-center mt-6"
          >
            <UButton
              color="neutral"
              variant="subtle"
              :loading="loadingMore"
              @click="showMore"
            >
              Show more matches
            </UButton>
          </div>
        </template>
      </template>
    </div>

    <div
      v-if="routeData"
      class="rounded-lg border border-default p-4"
    >
      <p class="text-sm text-muted">
        Racing a different number of laps, or want this route outside the event?
        <ULink
          :to="`/routes/${routeData.slug}`"
          class="text-primary underline"
        >See the full {{ routeData.name }} route analysis</ULink>.
      </p>
    </div>

    <EventsDisclaimer
      :organizer="season!.organizer"
      :organizer-url="season!.organizerUrl"
    />
  </UContainer>
</template>
