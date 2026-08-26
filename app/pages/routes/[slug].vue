<script setup lang="ts">
import type { ComboScore } from '../../../shared/types/catalog'
import type { PublishableRace } from '../../../shared/utils/events'
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { geometryForRouteLaps } from '#shared/utils/physics/routeGeometry'

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const { owned, ownedWheels, load: loadGarage } = useGarage()
// Read-only here: the controls themselves (sliders, draft disclosure,
// category/search/switches) live in `RiderProfileControls` /
// `BikeFilterControls`, which bind and persist this same `useState`-backed
// state - so the query and watchers below keep firing exactly as before.
const { weightKg, heightCm, powerW, defaultUnownedLevel, draftMode, tttRiders, tttClimbWkg } = useRiderProfile()
const { verifiedOnly, myBikesOnly, bikeCategory, showUpcomingRaces, includeHaloBikes, setBikeCategory, setIncludeHaloBikes } = usePreferences()

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
const laps = ref(1)

const recommendQuery = computed(() => ({
  search: bikeSearchDebounced.value || undefined,
  // Omitted rather than sent as `all`: the endpoint reads any non-empty
  // `category` as a value to match against, so `all` would match no frame at
  // all. "Absent" is the API's own spelling of "every category".
  category: bikeCategory.value !== 'all' ? bikeCategory.value : undefined,
  limit: pageSize,
  offset: 0,
  // Always sent, never omitted: the endpoint now defaults this to on, so
  // leaving it out when the switch is off would silently keep filtering.
  verifiedOnly: verifiedOnly.value ? 'true' : 'false',
  // Always sent for the same reason: the endpoint defaults to include, while
  // this preference defaults to exclude (see `usePreferences`).
  includeHalo: includeHaloBikes.value ? 'true' : 'false',
  ownedOnly: myBikesOnly.value ? 'true' : undefined,
  owned: Object.keys(owned.value).length ? JSON.stringify(owned.value) : undefined,
  ownedWheels: Object.keys(ownedWheels.value).length ? JSON.stringify(Object.keys(ownedWheels.value)) : undefined,
  defaultUnownedLevel: defaultUnownedLevel.value,
  weightKg: weightKg.value,
  heightCm: heightCm.value,
  powerW: powerW.value,
  laps: laps.value,
  // Omitted entirely in solo mode, which is also the default: everything in
  // this query renders server-side from the DEFAULT rider profile and
  // preferences, since localStorage only loads onMounted. That default query
  // is what gets prerendered and what crawlers see. The watch below then
  // refetches after hydration, but only for a rider whose stored settings
  // actually differ from the defaults.
  // Race mode sends nothing but the mode itself - one calibrated constant, no
  // parameters - so its cache key stays as clean as solo's.
  draftMode: draftMode.value === 'solo' ? undefined : draftMode.value,
  tttRiders: draftMode.value === 'ttt' ? tttRiders.value : undefined,
  tttClimbWkg: draftMode.value === 'ttt' ? tttClimbWkg.value : undefined
}))

// Fired together (not sequentially) - the recommend query only depends on `slug` plus rider
// profile/garage/preference state above, none of which depends on the route lookup resolving first.
const [{ data: routeData, error: routeError }, { data: recommendData, status, refresh: refreshRecommendations, error: recommendError }] = await Promise.all([
  useFetch(() => `/api/routes/${slug.value}`),
  useFetch(() => `/api/recommend/${slug.value}`, { query: recommendQuery, watch: false })
])
if (routeError.value) throw createError({ statusCode: 404, statusMessage: 'Route not found', fatal: true })
useRefetchNotice(recommendError, status, refreshRecommendations)

// Per-route rather than a flat 1..MAX_LAPS: `maxLapsForRoute` also caps the
// total ride at MAX_TOTAL_DISTANCE_KM, and offering a lap count the server's
// `clampLaps` would then quietly shrink shows totals for a ride nobody gets.
// Declared AFTER the fetch above: `watch` reads its source eagerly on the
// client, so referencing `routeData` any earlier is a TDZ crash on hydration.
const lapOptions = computed(() => Array.from(
  { length: routeData.value ? maxLapsForRoute(routeData.value) : MAX_LAPS },
  (_, i) => ({ label: `${i + 1} lap${i === 0 ? '' : 's'}`, value: i + 1 })
))
// A selection made on one route can outlive navigation to a shorter one -
// snap it back rather than sending a lap count the picker no longer offers.
watch(lapOptions, (options) => {
  if (laps.value > options.length) laps.value = 1
})

useSeoMeta({
  title: () => routeData.value ? `Best Bike for ${routeData.value.name} - ZwiftBikes` : 'ZwiftBikes',
  description: () => routeData.value
    ? `Find the fastest bike and wheel combo for ${routeData.value.name} in ${routeData.value.worldName}. Distance, elevation and surface-aware recommendations.`
    : undefined,
  ogTitle: () => routeData.value ? routeData.value.name : undefined,
  ogDescription: () => routeData.value
    ? `Find the fastest bike and wheel combo for ${routeData.value.name} in ${routeData.value.worldName}.`
    : undefined
})

// Issue #59: a generated card replaces the old hotlinked world minimap.
// Snapshotted once at setup, which is exactly the build-time prerender pass
// (zeroRuntime never re-renders): the top combo is therefore the DEFAULT
// rider profile's - the same ranking the prerendered page itself shows -
// and combo names, not a finish time, go on the card because a time is only
// meaningful for a specific rider.
if (routeData.value) {
  const totals = computeRouteTotals(routeData.value, 1)
  const ogTopCombo = recommendData.value?.combos?.[0]
  defineOgImage('RouteCard', {
    title: routeData.value.name,
    world: routeData.value.worldName,
    distance: formatDistance(totals.distanceKm),
    elevation: formatElevation(totals.elevationM),
    frameName: ogTopCombo?.frame.name,
    wheelName: ogTopCombo?.wheelset?.name,
    profile: ogProfileFromPoints(geometryForRouteLaps(routeData.value, 1).points)
  }, {
    alt: `Best bike for ${routeData.value.name} in ${routeData.value.worldName}: route profile and the fastest bike and wheel setup`
  })
}

onMounted(() => {
  loadGarage()
  // "Featured in" cross-links - client-only: this page is prerendered, so
  // "upcoming" resolved at render time would bake the build date into the
  // shipped HTML. The row simply never appears when nothing is coming up.
  upcomingEvents.value = getUpcomingEventsForRoute(slug.value, new Date().toISOString().slice(0, 10))
})
const upcomingEvents = ref<PublishableRace[]>([])

const routeTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, laps.value) : undefined)
const climbOccurrences = computed(() => routeData.value ? expandClimbsForLaps(routeData.value, laps.value) : [])
const sprintOccurrences = computed(() => routeData.value ? expandSprintsForLaps(routeData.value, laps.value) : [])

const loadedCombos = ref<ComboScore[]>([])
const hasMore = ref(true)
const loadingMore = ref(false)
// The lap count the currently displayed combos were computed for. `laps`
// itself moves the header stats immediately, which is right - but every speed
// readout divides a distance by a `finishTimeSec` from the last response, and
// pairing the NEW distance with the OLD time shows a wrong km/h until the
// refetch lands. The FAQ text and the result cards read this lagged value
// instead, which catches up exactly when the recomputed times do.
const resultsLaps = ref(laps.value)
watch(recommendData, (data) => {
  if (!data) return
  loadedCombos.value = data.combos ?? []
  hasMore.value = data.pagination?.hasMore ?? false
  resultsLaps.value = laps.value
}, { immediate: true })
const resultsTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, resultsLaps.value) : undefined)

// Whether the team climb pace control is worth showing at all - see the
// `hasLongClimb` prop on `RiderProfileControls`. Deliberately keyed on the
// rider's NORMAL power, never on `tttClimbWkg`: the climb pace must not
// decide its own slider's visibility, or the control vanishes under the
// user's cursor as they drag it.
const hasLongClimb = computed(() => routeData.value
  ? detectLongClimbBlocks(geometryForRouteLaps(routeData.value, resultsLaps.value), powerW.value, weightKg.value).length > 0
  : true)

// `recommendData` keeps its previous value while a refetch (filter/rider
// profile/laps change) is in flight, so `status === 'pending'` alone can't
// tell a genuine first load (nothing to show yet) apart from a refresh of
// already-visible results (show stale cards + a subtle "updating" hint).
const isFirstLoad = computed(() => status.value === 'pending' && !recommendData.value)
const isRefreshingCombos = computed(() => status.value === 'pending' && !!recommendData.value)

async function refreshFirstPage() {
  // Keep the current results mounted while the new recommendation request is
  // running. Clearing the cards first makes the page temporarily much shorter,
  // which causes the browser to clamp scrollY back to the top. The refreshed
  // results will replace these in-place once the request completes.
  await refreshRecommendations()
}

async function showMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const nextPage = await $fetch(`/api/recommend/${slug.value}`, {
      query: { ...recommendQuery.value, offset: loadedCombos.value.length, limit: pageSize }
    })
    loadedCombos.value = [...loadedCombos.value, ...(nextPage.combos ?? [])]
    hasMore.value = nextPage.pagination?.hasMore ?? false
  } finally {
    loadingMore.value = false
  }
}

watch([weightKg, heightCm, powerW, laps, defaultUnownedLevel, myBikesOnly, verifiedOnly, includeHaloBikes, bikeCategory, bikeSearchDebounced, draftMode, tttRiders, tttClimbWkg], () => refreshFirstPage())
watch(owned, () => refreshFirstPage(), { deep: true })
watch(ownedWheels, () => refreshFirstPage(), { deep: true })

const combos = computed(() => loadedCombos.value)
const topCombo = computed(() => combos.value[0])
const restCombos = computed(() => combos.value.slice(1))
const fastestTimeSec = computed(() => {
  const times = combos.value.map(c => c.finishTimeSec).filter((t): t is number => typeof t === 'number')
  return times.length ? Math.min(...times) : undefined
})
const surfaceTimePenaltyText = computed(() => routeData.value ? formatSurfaceTimePenalty(routeData.value.surface, topCombo.value?.surfaceTimePenaltySec) : undefined)
const physicsInfo = computed(() => recommendData.value?.physics)
// Present only when the category filter is hiding a faster combo - see
// `FastestOverallNote` and the endpoint's `fastestOverall` block.
const fastestOverall = computed(() => recommendData.value?.fastestOverall)
const physicsIsDynamic = computed(() => physicsInfo.value?.mode === 'dynamic')
const tttSavingText = computed(() => formatTttTimeSaving(physicsInfo.value?.ttt))
const raceSavingText = computed(() => formatRaceTimeSaving(physicsInfo.value?.race))

const faqQuestion = computed(() => routeData.value ? `What's the fastest bike for ${routeData.value.name}?` : undefined)
const faqAnswer = computed(() => {
  if (!routeData.value || !topCombo.value || typeof topCombo.value.finishTimeSec !== 'number') return undefined
  const equipment = topCombo.value.wheelset ? `${topCombo.value.frame.name} with ${topCombo.value.wheelset.name}` : topCombo.value.frame.name
  const distanceKm = resultsTotals.value?.distanceKm ?? routeData.value.distance
  return `Based on our physics model, the ${equipment} is currently the fastest verified combo for ${routeData.value.name} in ${routeData.value.worldName}, finishing in ${formatDuration(topCombo.value.finishTimeSec)} (~${formatSpeedKmh(distanceKm, topCombo.value.finishTimeSec)}).`
})

const siteConfig = useSiteConfig()
const canonicalUrl = useCanonicalUrl()
useHead(() => {
  if (!routeData.value) return {}
  const scripts = [{
    type: 'application/ld+json' as const,
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
        { '@type': 'ListItem', 'position': 2, 'name': routeData.value.name, 'item': canonicalUrl.value }
      ]
    }).replace(/</g, '\\u003c')
  }]
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
  <UContainer
    v-if="routeData"
    class="py-10 space-y-10"
  >
    <div>
      <UButton
        to="/"
        variant="link"
        color="neutral"
        icon="i-lucide-arrow-left"
        class="mb-4 px-0"
      >
        Back to all routes
      </UButton>
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold text-highlighted">
            {{ routeData.name }}
          </h1><p class="text-muted">
            {{ routeData.worldName }}
          </p>
        </div>
        <div class="flex flex-col items-start sm:items-end gap-1.5">
          <div class="flex flex-wrap sm:justify-end gap-2">
            <TerrainBadge :terrain="routeData.terrain" /><SurfaceBadges :surface="routeData.surface" />
            <UBadge
              v-if="physicsIsDynamic"
              color="primary"
              variant="subtle"
              icon="i-lucide-atom"
            >
              Dynamic physics
            </UBadge>
            <UBadge
              v-if="routeData.eventOnly"
              color="error"
              variant="subtle"
              icon="i-lucide-calendar-clock"
            >
              Event only
            </UBadge>
          </div><p
            v-if="surfaceTimePenaltyText"
            class="text-xs text-muted sm:text-right"
          >
            {{ surfaceTimePenaltyText }}
          </p><p
            v-if="tttSavingText"
            class="text-xs text-muted sm:text-right"
          >
            {{ tttSavingText }}
          </p><p
            v-if="raceSavingText"
            class="text-xs text-muted sm:text-right"
          >
            {{ raceSavingText }}
          </p>
        </div>
      </div>
      <div class="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Distance
          </p><p class="text-xl font-bold">
            {{ formatDistance(routeTotals?.distanceKm ?? routeData.distance) }}
          </p>
        </UCard>
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Elevation
          </p><p class="text-xl font-bold">
            {{ formatElevation(routeTotals?.elevationM ?? routeData.elevation) }}
          </p>
        </UCard>
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Climb ratio
          </p><p class="text-xl font-bold">
            {{ routeData.terrain.climbRatio.toFixed(1) }} m/km
          </p>
        </UCard>
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Terrain
          </p><p class="text-xl font-bold">
            {{ TERRAIN_LABELS[routeData.terrain.category] }}
          </p>
        </UCard>
      </div>
      <div
        v-if="routeData.lap || routeData.leadInDistance"
        class="mt-4 flex flex-wrap items-end gap-4 rounded-lg border border-default p-4"
      >
        <div
          v-if="routeData.lap"
          class="w-40"
        >
          <label class="block text-xs font-medium text-muted mb-1">Laps</label><USelectMenu
            v-model="laps"
            value-key="value"
            :items="lapOptions"
            :search-input="false"
          />
        </div>
        <p
          v-if="routeTotals && routeTotals.leadInDistanceKm > 0"
          class="text-sm text-muted"
        >
          <span class="font-medium text-highlighted">Lead-in:</span> {{ formatDistance(routeTotals.leadInDistanceKm) }}<template v-if="routeTotals.leadInElevationM > 0">
            / {{ formatElevation(routeTotals.leadInElevationM) }}
          </template> (ridden once, not repeated per lap)
        </p>
      </div>
    </div>

    <UAlert
      v-if="showUpcomingRaces && upcomingEvents.length"
      color="info"
      variant="subtle"
      icon="i-lucide-calendar-days"
      title="This route features in upcoming races"
    >
      <template #description>
        <span
          v-for="(entry, index) in upcomingEvents"
          :key="entry.path"
        >
          <ULink
            :to="entry.path"
            class="text-primary underline"
          >{{ entry.season.seriesName }} {{ entry.season.label }} {{ raceDisplayName(entry.race) }}</ULink>
          ({{ formatRaceDateRange(entry.race.date, entry.race.endDate) }})<span v-if="index < upcomingEvents.length - 1">, </span>
        </span>
      </template>
    </UAlert>

    <div v-if="faqAnswer">
      <h2 class="text-lg font-semibold text-highlighted mb-2">
        {{ faqQuestion }}
      </h2>
      <p class="text-muted">
        {{ faqAnswer }}
      </p>
    </div>

    <RouteSurfaceSpeedProfile
      v-if="topCombo"
      :route="routeData"
      :frame="topCombo.frame"
      :wheelset="topCombo.wheelset"
      :weight-kg="weightKg"
      :height-cm="heightCm"
      :power-w="powerW"
      :draft-mode="draftMode"
      :ttt-riders="tttRiders"
      :ttt-climb-wkg="tttClimbWkg"
    />

    <RacePlanPanel
      v-if="draftMode === 'ttt' && topCombo"
      :route="routeData"
      :laps="laps"
      :weight-kg="weightKg"
      :height-cm="heightCm"
      :power-w="powerW"
      :frame="topCombo.frame"
      :wheelset="topCombo.wheelset"
      :ttt-riders="tttRiders"
      :ttt-climb-wkg="tttClimbWkg"
    />

    <div v-if="routeData.terrain.elevationProfile && routeData.terrain.elevationProfile.length > 1">
      <RouteElevationProfile
        :route="routeData"
        :laps="laps"
        :climbs="climbOccurrences"
        :sprints="sprintOccurrences"
      />
    </div>

    <div
      v-if="climbOccurrences.length || sprintOccurrences.length || routeData.surface.composition"
      class="grid grid-cols-1 lg:grid-cols-3 gap-6"
    >
      <div
        v-if="climbOccurrences.length || sprintOccurrences.length"
        class="lg:col-span-2 space-y-6"
      >
        <div v-if="climbOccurrences.length">
          <h2 class="text-lg font-semibold text-highlighted mb-3">
            Climbs on this route
          </h2>
          <RouteClimbs :climbs="climbOccurrences" />
        </div>
        <div v-if="sprintOccurrences.length">
          <h2 class="text-lg font-semibold text-highlighted mb-3">
            Sprints on this route
          </h2>
          <RouteSprints :sprints="sprintOccurrences" />
        </div>
      </div>
      <div v-if="routeData.surface.composition">
        <h2 class="text-lg font-semibold text-highlighted mb-3">
          Surface
        </h2>
        <RouteSurfaceComposition :surface="routeData.surface" />
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
        Best bike &amp; wheel combo for this route
      </h2>
      <RecommendDataNotice />
      <BikeFilterControls
        v-model:search="bikeSearch"
        class="mb-6"
      />

      <RiderProfileControls
        :has-long-climb="hasLongClimb"
        class="mb-6"
      />

      <div
        v-if="isFirstLoad"
        class="space-y-4"
      >
        <ComboResultCardSkeleton class="mb-6" />
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ComboResultCardSkeleton /><ComboResultCardSkeleton />
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
            :route="routeData"
            :weight-kg="weightKg"
            :height-cm="heightCm"
            :power-w="powerW"
            :laps="resultsLaps"
            :fastest-time-sec="fastestTimeSec"
            :owned="owned"
            :draft-mode="draftMode"
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
              :route="routeData"
              :weight-kg="weightKg"
              :height-cm="heightCm"
              :power-w="powerW"
              :laps="resultsLaps"
              :fastest-time-sec="fastestTimeSec"
              :owned="owned"
              :draft-mode="draftMode"
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
        <ReportDataLink :item="routeData?.name" />
      </template>
    </div>
  </UContainer>
</template>
