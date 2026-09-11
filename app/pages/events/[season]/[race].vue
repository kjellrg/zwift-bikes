<script setup lang="ts">
import type { Ride } from '../../../utils/recommendRequest'
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { rideForRoute } from '#shared/utils/recommendRide'
import { expandClimbsForLaps, expandSprintsForLaps } from '#shared/utils/routeOccurrences'

/**
 * One race. Everything a route page can't know lives here: the date, the
 * lap count for the rider's category group, and the equipment rules - Zwift
 * disables TT frames for points and scratch races, so a recommendation that
 * ignored the format would put an illegal bike at the top of the list.
 *
 * The ranking itself goes through `useRecommendRequest`, the same composable
 * the route and segment pages hand a Ride to, and the page is built from the
 * same components, so the three can't drift in behaviour - this page's only
 * job is to say what the ride IS, and what is legal on it.
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

// Read-only plus `setDraftMode` (for the format hint below): the controls
// themselves live in `RiderProfileControls` / `RideEquipmentFilters`, and
// `useRecommendRequest` reads the rest of this state itself.
const { weightKg, powerW, draftMode, setDraftMode } = useRiderProfile()
const { setBikeCategory, setIncludeHaloBikes } = usePreferences()

// A/B and C/D routinely race the same route over a different number of laps,
// which changes the distance, the climbing and therefore the ranking - so the
// group is the page's primary control, not a footnote. A Category group (see
// `CONTEXT.md`) is the race's, never the rider's: the laps come with it.
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
 * The Ride: this group's course and lap count, plus the two equipment rules
 * a race has and a route page doesn't.
 *
 * `useRecommendRequest` makes the rider's stored settings race-legal from
 * them - a rider whose stored category is `tt` is ranked across all legal
 * categories where TT frames are outlawed (matching the "All categories" the
 * hidden-TT select shows them), and a race WTRL turns drafting off in is
 * ranked solo, because a ranking computed at bunch speeds there would be
 * minutes fast and could genuinely reorder the list. Neither stored
 * preference is touched: both still apply to every other race they open.
 *
 * A group with no catalog route has no endpoint, so nothing is requested and
 * nothing is ranked - the page still shows that group's published figures.
 */
/**
 * One spelling of a course's recommend endpoint, because two things compare
 * against it: the Ride that asks for a ranking, and the applied-course
 * snapshot below that recognises the answer. A second spelling is how those
 * two would drift into never matching, silently.
 */
const recommendEndpoint = (slug: string) => `/api/recommend/${slug}`

const ride = computed<Ride>(() => ({
  endpoint: selectedRouteSlug.value ? recommendEndpoint(selectedRouteSlug.value) : undefined,
  laps: laps.value,
  ttFramesAllowed: ttAllowed,
  draftingAllowed: draftAllowed
}))
const {
  ready: recommendReady, physics: physicsInfo, fastestOverall,
  combos, topCombo, fastestTimeSec, hasMore, loadingMore, showMore,
  appliedInputs, appliedRide, isFirstLoad, isRefreshing, resultsAnnouncement,
  bikeSearch, bikeSearchDebounced, loadWheelOptions, serializedQuery
} = useRecommendRequest(() => ride.value, { key: `recommend-race-${seasonSlug.value}-${raceSlug.value}` })

// `useAsyncData` rather than `useFetch` for the route lookup: the selected
// category group can change which route is being shown, and can have no
// route at all, which a `useFetch` URL can't express. The route lookup is
// keyed on the slug so switching category fetches that group's route instead
// of reusing the previous one. Fired together with the recommendation, which
// doesn't depend on it resolving first.
const [{ data: routeData }] = await Promise.all([
  useAsyncData(
    () => `race-route-${selectedRouteSlug.value ?? 'none'}`,
    () => selectedRouteSlug.value ? $fetch(`/api/routes/${selectedRouteSlug.value}`) : Promise.resolve(null),
    { watch: [selectedRouteSlug] }
  ),
  recommendReady
])

// `?group=1&bike=tarmac&category=tt&draft=ttt` - see `useSharedView`. The
// group is the one knob a race link carries beyond the Ride's identity: it
// changes the course and the lap count, and it is an index, so the first
// group is the value a clean link omits. Laps are deliberately NOT carried -
// they come with the group, from the organiser, and are never the rider's to
// pick here.
useSharedView(
  { bikeSearch, bikeSearchDebounced },
  { key: 'group', value: categoryGroupIndex, min: 0, max: () => categoryGroupOptions.length - 1 }
)

// Runtime site flags: with the events section hidden, this page swaps its
// content for the unavailable notice post-mount - the prerendered HTML
// always carries the content (server/middleware/site-flags-gate.ts gates
// the section's data endpoints meanwhile).
const { eventsVisible, eventsNotice, load: loadSiteFlags } = useSiteFlags()
onMounted(() => loadSiteFlags())

const raceHeading = computed(() => raceDisplayName(race!))
// Named under its round ("ZRacing 2026 - August: Makuri Madness Stage 4"):
// the round name is what riders search for, and every derived surface
// (title, description, FAQ, OG alt) inherits it from here.
const raceTitle = computed(() => `${raceContextLabel(season!, round)} ${raceHeading.value}`)

/**
 * `useAsyncData` resolves to `null` when the selected group has no catalog
 * route; the route components take `undefined`. Normalised once here rather
 * than asserted at each of the half-dozen places they're used.
 */
const routeInfo = computed(() => routeData.value ?? undefined)

const routeTotals = computed(() => routeInfo.value ? computeRouteTotals(routeInfo.value, laps.value) : undefined)
const climbOccurrences = computed(() => routeInfo.value ? expandClimbsForLaps(routeInfo.value, laps.value) : [])
const sprintOccurrences = computed(() => routeInfo.value ? expandSprintsForLaps(routeInfo.value, laps.value) : [])

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
const displayRouteName = computed(() => selectedGroup.value?.routeName ?? routeInfo.value?.name ?? 'Route TBC')

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
 * The powerups in one line. Computed rather than written into the briefing,
 * because a category group whose course isn't in the catalog has no briefing
 * and this is organiser data that never needed one - so it is rendered twice
 * and must read identically both times.
 */
const powerupsLine = computed(() => {
  if (!powerups) return undefined
  const allowed = powerups.allowed.length ? powerups.allowed.map(powerup => POWERUP_LABELS[powerup]).join(', ') : 'none'
  return `${allowed}${powerups.note ? ` - ${powerups.note}` : ''}`
})

/**
 * Same split as the answer's `rideRules` line: Zwift disables TT frames
 * itself for points and scratch races, while WTRL bans them by regulation in
 * a Race of Truth - where drafting being off would otherwise be the TT
 * bike's whole argument, so a rider is owed the reason rather than just the
 * verdict.
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

const scoringSegmentsTbd = computed(() => Boolean(selectedGroup.value?.scoringSegmentsTbd))
/**
 * A points race with nothing listed is a real, published state (three of
 * Round 1's do this) - worth saying out loud rather than rendering an empty
 * table that looks like a loading failure.
 */
const isPointsRaceWithoutSegments = computed(() => (race!.format === 'points' || race!.format === 'rot') && !scoringSegments.value.length)
/** Whether the Scoring tab exists at all: a scratch race scores nothing along the way. */
const hasScoring = computed(() => scoringSegments.value.length > 0 || isPointsRaceWithoutSegments.value || scoringSegmentsTbd.value)

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

// The lap count the combos on screen were computed for - a speed readout must
// divide a distance by a finish time computed for the SAME lap count, so this
// only advances when results for it actually arrive. See `appliedRide` on
// `useRecommendRequest`.
const resultsLaps = computed(() => appliedRide.value.laps ?? 1)
/**
 * The COURSE those combos were computed for - **Applied** (see `CONTEXT.md`)
 * extended from the rider to the Ride itself, because on this page alone the
 * Ride's own identity moves.
 *
 * Three clocks settle in any order when the group changes: the selector, the
 * route lookup (`routeData`, refetched on the new slug) and the recommend
 * response. Handing the new group's geometry to a chart drawn for the
 * previous group's top combo shows a speed curve for a bike that was never
 * ranked on that course. So this only advances when the route lookup and the
 * ranking agree on one slug, and everything equipment-dependent reads it;
 * the briefing, the header stats and the Ride-only tabs follow the selector,
 * which is what the rider just moved.
 */
const appliedRoute = shallowRef<NonNullable<typeof routeData.value>>()
watchEffect(() => {
  const endpoint = appliedRide.value.endpoint
  if (!endpoint) appliedRoute.value = undefined
  else if (routeData.value && recommendEndpoint(routeData.value.slug) === endpoint) appliedRoute.value = routeData.value
})
const resultsTotals = computed(() => appliedRoute.value ? computeRouteTotals(appliedRoute.value, resultsLaps.value) : undefined)
const resolvedRide = computed(() => appliedRoute.value ? rideForRoute(appliedRoute.value, resultsLaps.value, appliedRide.value.ttFramesAllowed === false) : undefined)

// Whether the team climb pace control is worth showing - see the
// `hasLongClimb` prop on `RiderProfileControls`. Keyed on the rider's NORMAL
// power, never on `tttClimbWkg`, so the climb pace can't decide its own
// slider's visibility.
const hasLongClimb = computed(() => resolvedRide.value
  ? detectLongClimbBlocks(resolvedRide.value.planGeometry(), powerW.value, weightKg.value).length > 0
  : true)

// The same readouts the route and segment pages show off the physics block:
// whether the ranking ran on measured route geometry, what the rough surface
// cost the recommended setup, and what the race's own draft is worth over
// riding it alone. All fall away by themselves when the selected group has no
// catalog route - there is no physics block without a ranking.
const physicsIsDynamic = computed(() => physicsInfo.value?.mode === 'dynamic')
const surfaceTimePenaltyText = computed(() => appliedRoute.value ? formatSurfaceTimePenalty(appliedRoute.value.surface, topCombo.value?.surfaceTimePenaltySec) : undefined)
const tttSavingText = computed(() => formatTttTimeSaving(physicsInfo.value?.ttt))
const raceSavingText = computed(() => formatRaceTimeSaving(physicsInfo.value?.race))
// The evidence lines under the recommended time - each is about the fastest
// combo, so they sit with it rather than under the race header.
const recommendationNotes = computed(() => [surfaceTimePenaltyText.value, tttSavingText.value, raceSavingText.value]
  .filter((note): note is string => Boolean(note)))
const limitedDataNote = computed(() => appliedRoute.value
  ? limitedCourseDataNote({
      hasElevationProfile: (appliedRoute.value.terrain.elevationProfile?.length ?? 0) > 1,
      hasSurfaceLocations: (appliedRoute.value.surface.segments?.length ?? 0) > 0
    })
  : undefined)
// One plan for the briefing's TTT line and the TTT plan tab, from the applied
// results - see `useTttPlan`. Undefined outside TTT drafting, which for a TTT
// race is exactly what the draft hint above offers to switch on.
const tttPlan = useTttPlan({
  route: () => appliedRoute.value,
  combo: () => topCombo.value,
  rider: () => appliedInputs.value,
  laps: () => resultsLaps.value,
  loading: () => isFirstLoad.value
})

const { keys: comparisonKeys, picked: comparedCombos, clear: clearComparison, remove: removeFromComparison } = useComparison(() => combos.value)

// Tells the open bike drawer whether its bike is still on a loaded page, and
// whether this Ride bars it outright - see `noteRankedFrames`. A TT frame
// whose drawer was opened on a route page is not slow here; it is illegal.
const { noteRankedFrames } = useOverlays()
watch(combos, list => noteRankedFrames(list, appliedRide.value), { immediate: true })

/** Only meaningful once the race window has closed - resolved client-side, see below. */
const isPast = ref(false)
onMounted(() => {
  isPast.value = raceEndDate(race!) < new Date().toISOString().slice(0, 10)
})

/**
 * The race's own rules, ahead of the answer and inside the one string the FAQ
 * structured data carries - see `rideRules` on `buildRecommendationAnswer`.
 * Who does the disabling differs and it matters to a rider reading the rules:
 * Zwift itself blocks TT frames in points and scratch races, whereas WTRL
 * bans them by regulation in a Race of Truth.
 */
const rideRules = computed(() => {
  const tt = ttAllowed
    ? 'TT bikes are allowed in this team time trial'
    : race!.format === 'rot'
      ? 'WTRL bans TT bikes from its Race of Truth'
      : `TT bikes are disabled for this ${formatPhrase.value}`
  return `${tt}${draftAllowed ? '' : ', and WTRL turns drafting off, so the time below is ridden solo'}.`
})

const faqQuestion = computed(() => `What bike should I ride for ${raceTitle.value}?`)
// The visible answer under the recommendation and the FAQ structured data are
// one text (`answer.text`), built from the APPLIED ranking - the course, the
// lap count and the rider the request was actually answered for - so what a
// crawler reads is what a rider sees.
const answer = useRecommendationAnswer({
  combo: () => topCombo.value,
  rideName: () => appliedRoute.value
    ? `${resultsLaps.value} lap${resultsLaps.value === 1 ? '' : 's'} of ${appliedRoute.value.name} in ${appliedRoute.value.worldName}`
    : undefined,
  distanceKm: () => resultsTotals.value?.distanceKm ?? appliedRoute.value?.distance,
  rider: () => appliedInputs.value,
  laps: () => resultsLaps.value,
  search: () => bikeSearchDebounced.value,
  rideRules: () => rideRules.value
})
const faqAnswer = computed(() => answer.value?.text)

const siteConfig = useSiteConfig()
const canonicalUrl = useCanonicalUrl()

useSeoMeta({
  title: () => `Best Bike for ${raceTitle.value} - ${routeNamesLabel.value} (${formatLabel.value}) - ZwiftBikes`,
  description: () => hasSplitCourses(race!)
    ? `${raceTitle.value}: ${formatLabel.value} on ${formatRaceDate(race!.date)} - ${routeNamesByCategory.value}. Lap counts per category, TT bike rules, and the fastest legal bike and wheel combo for each course.`
    : `${raceTitle.value}: ${formatLabel.value} on ${routeNamesLabel.value}, ${formatRaceDate(race!.date)}. Lap counts per category, TT bike rules, and the fastest legal bike and wheel combo.`,
  ogTitle: () => `${raceHeading.value} - ${routeNamesLabel.value}`,
  ogDescription: () => hasSplitCourses(race!)
    ? `The fastest legal bike and wheel combo for ${raceTitle.value} - ${routeNamesByCategory.value}.`
    : `The fastest legal bike and wheel combo for ${raceTitle.value} on ${routeNamesLabel.value}.`
})

// Issue #59: a generated card replaces the old hotlinked world minimap.
// Snapshotted once at setup - the build-time prerender pass (zeroRuntime
// never re-renders) - so the combo is the DEFAULT rider profile's, matching
// what the prerendered page shows. Only races whose categories ride
// different ROUTES skip the combo line (one combo would be wrong for most
// readers) - deliberately narrower than `hasSplitCourses`, which also
// splits on lap count: same route with more laps is the same terrain mix,
// so the fastest combo holds.
const ogRouteCount = new Set(race!.categories.map(group => group.routeSlug ?? group.routeName ?? '')).size
const ogTopCombo = ogRouteCount > 1 ? undefined : topCombo.value
defineOgImage('EventCard', {
  series: raceContextLabel(season!, round),
  title: raceHeading.value,
  course: `${routeNamesLabel.value} · ${formatLabel.value}`,
  date: formatRaceDate(race!.date),
  frameName: ogTopCombo?.frame.name,
  wheelName: ogTopCombo?.wheelset?.name
}, {
  alt: `${raceTitle.value} on ${routeNamesLabel.value}: date, format and the fastest legal bike and wheel setup`
})

useHead(() => {
  if (!routeData.value) return {}
  // Keyed for the same reason as on the route and segment pages: unhead
  // then updates the server-rendered tag in place instead of adding a second
  // FAQ script when the answer changes during hydration.
  const scripts = [
    {
      key: 'breadcrumbs',
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
    }
  ]
  if (faqAnswer.value) {
    scripts.push({
      key: 'faq',
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
  <EventsUnavailableNotice
    v-if="!eventsVisible"
    :notice="eventsNotice"
  />
  <UContainer
    v-else
    class="py-8 space-y-8"
  >
    <div class="space-y-6">
      <div class="flex flex-wrap items-center gap-3 text-sm text-muted">
        <UButton
          :to="`/events/${season!.slug}`"
          variant="link"
          color="neutral"
          icon="i-lucide-arrow-left"
          class="px-0"
        >
          {{ season!.seriesName }} {{ season!.label }} schedule
        </UButton>
        <span class="border-l border-default pl-3"><template v-if="routeInfo">{{ routeInfo.worldName }} / </template>race</span>
      </div>
      <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
            {{ raceContextLabel(season!, round) }}
          </p>
          <h1 class="mt-1 text-3xl font-bold text-highlighted break-words sm:text-4xl">
            {{ raceHeading }}: {{ displayRouteName }}
          </h1>
          <p class="mt-1 text-muted">
            <template v-if="race!.endDate">
              {{ formatRaceDateRange(race!.date, race!.endDate) }}
            </template>
            <template v-else>
              {{ formatRaceDate(race!.date) }}
            </template>
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
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
            <template v-if="routeInfo">
              <TerrainBadge :terrain="routeInfo.terrain" /><SurfaceBadges :surface="routeInfo.surface" />
            </template>
            <UBadge
              v-if="physicsIsDynamic"
              color="primary"
              variant="subtle"
              icon="i-lucide-atom"
            >
              Dynamic physics
            </UBadge>
          </div>
          <p
            v-if="race!.sourceUrl || season!.organizerUrl"
            class="mt-3 text-sm"
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
        <!-- `routeTotals` follows the group selector immediately; the finish
             time below follows once the ranking for that group lands. -->
        <dl class="grid shrink-0 grid-cols-3 gap-4 sm:gap-8">
          <div>
            <dt class="text-xs text-muted">
              Total distance
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ formatDistance(routeTotals?.distanceKm ?? selectedGroup?.officialDistanceKm ?? 0) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Elevation
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ formatElevation(routeTotals?.elevationM ?? selectedGroup?.officialElevationM ?? 0) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Laps
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ laps }}
            </dd>
          </div>
        </dl>
      </div>

      <p
        v-if="officialDiffers"
        class="text-xs text-muted"
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

      <UAlert
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
        color="error"
        variant="subtle"
        icon="i-lucide-wind"
        title="Drafting is disabled in this race"
        description="WTRL turns the draft off for a Race of Truth: there is no bunch to sit in, so every rider covers the course on their own power. The ranking below is computed solo for exactly that reason, and aerodynamics count for more here than in a normal road race. Your saved draft setting is untouched and still applies everywhere else."
      />

      <!-- Where a route page puts its lap picker: the one control that
           changes what is being ranked. Laps are not offered beside it -
           they come with the group, from the organiser. -->
      <div
        v-if="categoryGroupOptions.length > 1"
        class="flex flex-wrap items-end gap-4"
      >
        <div class="w-64 max-w-full">
          <label class="mb-1 block text-xs font-medium text-muted">Your race group</label><USelectMenu
            v-model="categoryGroupIndex"
            value-key="value"
            :items="categoryGroupOptions"
            :search-input="false"
            aria-label="Your race group"
          />
        </div>
        <p class="pb-2 text-sm text-muted">
          The stats, the course analysis and the bike ranking below all follow this.
        </p>
      </div>

      <!-- The differences readable at a glance, without toggling the selector. -->
      <div
        v-if="coursesDiffer"
        class="overflow-x-auto rounded-lg border border-default"
      >
        <table class="w-full text-sm">
          <caption class="sr-only">
            Course, laps and published figures for each category group in this race
          </caption>
          <thead class="bg-elevated/50">
            <tr class="text-left text-muted">
              <th
                scope="col"
                class="px-4 py-2 font-medium"
              >
                Category
              </th>
              <th
                scope="col"
                class="px-4 py-2 font-medium"
              >
                Course
              </th>
              <th
                scope="col"
                class="px-4 py-2 font-medium"
              >
                Laps
              </th>
              <th
                scope="col"
                class="px-4 py-2 font-medium"
              >
                Distance
              </th>
              <th
                scope="col"
                class="px-4 py-2 font-medium"
              >
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

      <!-- Curated race context, not a property of any ranking: it belongs
           with the rules above rather than below results a group may not
           even have. -->
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

      <RideRiderSummary
        :rider="appliedInputs"
        :refreshing="isRefreshing"
        :has-long-climb="hasLongClimb"
        :draft-locked="!draftAllowed"
      />
      <RideEquipmentFilters :hide-tt-category="!ttAllowed" />
    </div>

    <RecommendDataNotice />
    <p
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ resultsAnnouncement }}
    </p>

    <UAlert
      v-if="groupHasNoRoute"
      color="neutral"
      variant="subtle"
      icon="i-lucide-map-pin-off"
      :title="`${displayRouteName} isn't in the public route catalog`"
      :description="`${season!.organizer} runs ${formatCategoryGroup(selectedGroup ?? { cats: [] })} on an event-exclusive route we have no data for, so there is no distance, elevation or surface to simulate against - and a ranking computed from a guess would be worse than none. The published figures above are ${season!.organizer}'s own.${categoryGroupOptions.length > 1 ? ' Pick another race group above to see recommendations for the routes we do have.' : ''}`"
    />

    <!-- Everything the organiser published that needs no catalog route. With
         a course the briefing and the Scoring tab carry these; without one
         there is neither, and they are not the ranking's to take away. -->
    <div
      v-if="groupHasNoRoute"
      class="space-y-4"
    >
      <p
        v-if="powerupsLine"
        class="text-sm text-muted"
      >
        <span class="font-medium text-highlighted">PowerUps:</span> {{ powerupsLine }}
      </p>
      <div v-if="hasScoring">
        <h2 class="text-lg font-semibold text-highlighted mb-2">
          Where the points are
        </h2>
        <RaceScoringSegments
          :rows="scoringRows"
          :tbd="scoringSegmentsTbd"
          :organizer="season!.organizer"
          :group-label="formatCategoryGroup(selectedGroup ?? { cats: [] })"
          :tt-allowed="ttAllowed"
        />
      </div>
    </div>

    <template v-else>
      <div
        v-if="draftHint"
        class="flex flex-wrap items-center gap-3 rounded-lg border border-default p-4"
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

      <!-- The recommendation is first in source order and first on a phone;
           on a desktop the briefing takes the left column and the
           recommendation the wider right one. The briefing reads only the
           Ride, so it renders through a refetch and with no matches. -->
      <div
        id="ride-results"
        class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12"
        :aria-busy="isFirstLoad || isRefreshing"
      >
        <div class="lg:col-start-2 lg:row-start-1 lg:border-l lg:border-default lg:pl-12">
          <div
            v-if="isFirstLoad"
            class="space-y-4"
          >
            <ComboResultCardSkeleton />
          </div>
          <template v-else>
            <p
              v-if="isRefreshing"
              class="mb-3 flex items-center gap-1.5 text-sm text-muted"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-4 animate-spin"
              />Updating results…
            </p>
            <div
              class="transition-opacity"
              :class="{ 'opacity-60 pointer-events-none': isRefreshing }"
            >
              <!-- The APPLIED course and lap count, not the selector's: the
                   km/h beside the time divides a distance by a time, and the
                   two must describe one ride. -->
              <RideRecommendation
                v-if="topCombo"
                :combo="topCombo"
                :route="appliedRoute"
                :laps="resultsLaps"
                :fastest-time-sec="fastestTimeSec"
                :load-wheel-options="loadWheelOptions"
                :request-key="serializedQuery"
                :limited-data-note="limitedDataNote"
                :notes="recommendationNotes"
              >
                <template #fastest-overall>
                  <!-- `pointer-events-auto`: the wrapper blocks clicks on stale
                       results while a refetch runs, but the reveal is a filter
                       change, not a stale result, and stays usable as before. -->
                  <FastestOverallNote
                    v-if="fastestOverall"
                    :fastest-overall="fastestOverall"
                    class="mb-0 pointer-events-auto"
                    @show-all="setBikeCategory('all')"
                    @include-halo="setIncludeHaloBikes(true)"
                  />
                </template>
              </RideRecommendation>
              <section
                v-else
                aria-label="Recommended setup"
                class="space-y-4"
              >
                <p class="text-muted">
                  No bikes match your filters.
                  <template v-if="bikeSearchDebounced">
                    Clear the search below or widen the filters above to see the ranking again.
                  </template>
                  <template v-else>
                    Widen the filters above to see the ranking again.
                  </template>
                </p>
                <FastestOverallNote
                  v-if="fastestOverall"
                  :fastest-overall="fastestOverall"
                  class="mb-0 pointer-events-auto"
                  @show-all="setBikeCategory('all')"
                  @include-halo="setIncludeHaloBikes(true)"
                />
                <ul
                  v-if="recommendationNotes.length"
                  class="space-y-1 text-sm text-muted"
                >
                  <li
                    v-for="note in recommendationNotes"
                    :key="note"
                  >
                    {{ note }}
                  </li>
                </ul>
              </section>
            </div>
          </template>
        </div>
        <!-- The selector's route and lap count, not the applied ones: the
             briefing describes the race the rider has picked a group for. -->
        <RideBriefing
          v-if="routeInfo && routeTotals"
          :route="routeInfo"
          :kind="formatLabel"
          per-lap
          class="lg:col-start-1 lg:row-start-1"
        >
          <li v-if="selectedGroup && categoryGroupOptions.length > 1">
            Ridden by {{ formatCategoryGroup(selectedGroup) }} in this race.
          </li>
          <li v-if="climbOccurrences[0]">
            {{ climbOccurrences.length }} mapped climb occurrence{{ climbOccurrences.length === 1 ? '' : 's' }}. First: {{ climbOccurrences[0].name }} at km {{ climbOccurrences[0].rideFromKm.toFixed(1) }}.
          </li>
          <li v-else>
            No mapped climbs on this ride.
          </li>
          <TttBriefingLine
            v-if="tttPlan"
            :plan="tttPlan"
          />
          <li>
            {{ laps }} lap{{ laps === 1 ? '' : 's' }}<template v-if="routeTotals.leadInDistanceKm > 0">
              + {{ formatDistance(routeTotals.leadInDistanceKm) }} lead-in<template v-if="routeTotals.leadInElevationM > 0">
                / {{ formatElevation(routeTotals.leadInElevationM) }}
              </template>, ridden once
            </template>
          </li>
          <!-- Curated fact only: absent powerup data renders no line at all. -->
          <li v-if="powerupsLine">
            <span class="font-medium text-highlighted">PowerUps:</span> {{ powerupsLine }}
          </li>
        </RideBriefing>
      </div>

      <!-- Full width beneath both columns: the answer the page's title asks
           for, its rules first, with its assumptions on a smaller line. -->
      <section
        v-if="answer"
        aria-labelledby="ride-answer-heading"
        class="border-y border-default py-5"
      >
        <h2
          id="ride-answer-heading"
          class="text-lg font-semibold text-highlighted"
        >
          {{ faqQuestion }}
        </h2>
        <p class="mt-2 text-muted">
          {{ answer.summary }}
        </p>
        <p class="mt-1 text-xs text-muted">
          {{ answer.assumptions }}
        </p>
      </section>

      <!-- Ride-only tabs follow the selector, like the briefing; the
           equipment tabs follow the applied results, like the
           recommendation - and on this page those can be different courses. -->
      <RideCourseAnalysis
        v-if="routeInfo"
        :route="routeInfo"
        :results-route="appliedRoute"
        kind="route"
        :laps="laps"
        :results-laps="resultsLaps"
        :combo="topCombo"
        :rider="appliedInputs"
        :refreshing="isRefreshing"
        :loading="isFirstLoad"
        :plan="tttPlan"
        :scoring="hasScoring"
        :scoring-slugs="scoringSlugs"
      >
        <template #scoring>
          <RaceScoringSegments
            :rows="scoringRows"
            :tbd="scoringSegmentsTbd"
            :organizer="season!.organizer"
            :group-label="formatCategoryGroup(selectedGroup ?? { cats: [] })"
            :tt-allowed="ttAllowed"
          />
        </template>
      </RideCourseAnalysis>

      <div
        v-if="!isFirstLoad"
        class="transition-opacity"
        :class="{ 'opacity-60 pointer-events-none': isRefreshing }"
      >
        <RideAlternatives
          v-model:search="bikeSearch"
          v-model:selected="comparisonKeys"
          :combos="combos"
          :route="appliedRoute"
          :laps="resultsLaps"
          :fastest-time-sec="fastestTimeSec"
          :load-wheel-options="loadWheelOptions"
          :request-key="serializedQuery"
          :has-more="hasMore"
          :loading-more="loadingMore"
          @show-more="showMore"
        />
        <ReportDataLink :item="`${raceTitle}${routeInfo ? ` (${routeInfo.name})` : ''}`" />
      </div>

      <RideComparison
        :combos="comparedCombos"
        :fastest-time-sec="fastestTimeSec"
        @clear="clearComparison"
        @remove="removeFromComparison"
      />

      <PhysicsNote
        v-if="physicsInfo"
        :mode="physicsInfo.mode"
        :summary="physicsInfo.summary"
        :note="physicsInfo.note"
      />

      <div
        v-if="routeInfo"
        class="rounded-lg border border-default p-4"
      >
        <p class="text-sm text-muted">
          Racing a different number of laps, or want this route outside the event?
          <ULink
            :to="`/routes/${routeInfo.slug}`"
            class="text-primary underline"
          >See the full {{ routeInfo.name }} route analysis</ULink>.
          <!-- The route page knows nothing of this race, so it ranks the TT
               frames this race bars. Better said than silently contradicted. -->
          <template v-if="!ttAllowed">
            It ranks every bike in the game, TT frames included - this race's rule is the race's,
            not the route's.
          </template>
        </p>
      </div>
    </template>

    <EventsDisclaimer
      :organizer="season!.organizer"
      :organizer-url="season!.organizerUrl"
    />
  </UContainer>
</template>
