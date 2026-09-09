<script setup lang="ts">
import type { PublishableRace } from '../../../shared/utils/events'
import type { Ride } from '../../utils/recommendRequest'
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { geometryForRouteLaps } from '#shared/utils/physics/routeGeometry'
import { expandClimbsForLaps, expandSprintsForLaps } from '#shared/utils/routeOccurrences'

const route = useRoute()
const slug = computed(() => route.params.slug as string)

// Read-only here: the controls that write them live in
// `RiderProfileControls` / `BikeFilterControls`, which bind and persist this
// same `useState`-backed state. `useRecommendRequest` reads it too, and owns
// every refetch it triggers.
const { weightKg, heightCm, powerW, draftMode, tttRiders, tttClimbWkg } = useRiderProfile()
const { showUpcomingRaces, setBikeCategory, setIncludeHaloBikes } = usePreferences()

const laps = ref(1)
const ride = computed<Ride>(() => ({ endpoint: `/api/recommend/${slug.value}`, laps: laps.value }))
const {
  ready: recommendReady, recommendData, physics: physicsInfo, fastestOverall,
  combos, topCombo, restCombos, fastestTimeSec, hasMore, loadingMore, showMore,
  appliedRide, isFirstLoad, isRefreshing, resultsAnnouncement, bikeSearch, bikeSearchDebounced, loadWheelOptions, owned
} = useRecommendRequest(() => ride.value, { key: `recommend-route-${slug.value}` })

// Fired together (not sequentially): the recommendation depends on the Ride and the rider's own
// stored state (both read inside `useRecommendRequest`), never on the route lookup resolving first.
const [{ data: routeData, error: routeError }] = await Promise.all([
  useFetch(() => `/api/routes/${slug.value}`),
  recommendReady
])
if (routeError.value) throw createError({ statusCode: 404, statusMessage: 'Route not found', fatal: true })

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

// `?laps=3&bike=tarmac&category=tt&draft=ttt` - see `useSharedView`. The
// lap ceiling is a function because it is only known now, after the fetch.
useSharedView({ bikeSearch, bikeSearchDebounced }, { laps, maxLaps: () => lapOptions.value.length })

// Same 1-lap lead-in-inclusive totals the OG card uses below, so the SERP
// snippet and the share card always quote the same numbers.
const metaStats = computed(() => {
  if (!routeData.value) return undefined
  const totals = computeRouteTotals(routeData.value, 1)
  return `${formatDistance(totals.distanceKm)} with ${formatElevation(totals.elevationM)} of climbing`
})

useSeoMeta({
  title: () => routeData.value ? `Best Bike for ${routeData.value.name} - ZwiftBikes` : 'ZwiftBikes',
  description: () => routeData.value
    ? `Find the fastest bike and wheel combo for ${routeData.value.name} in ${routeData.value.worldName} - ${metaStats.value}. Surface-aware recommendations.`
    : undefined,
  ogTitle: () => routeData.value ? routeData.value.name : undefined,
  ogDescription: () => routeData.value
    ? `Find the fastest bike and wheel combo for ${routeData.value.name} in ${routeData.value.worldName} - ${metaStats.value}.`
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

// "Featured in" cross-links - client-only: this page is prerendered, so
// "upcoming" resolved at render time would bake the build date into the
// shipped HTML. The row simply never appears when nothing is coming up.
// Keyed on the slug rather than set once on mount, because Nuxt reuses this
// component across a route -> route navigation (see #161).
const upcomingEvents = ref<PublishableRace[]>([])
onMounted(() => {
  watch(slug, (value) => {
    upcomingEvents.value = getUpcomingEventsForRoute(value, new Date().toISOString().slice(0, 10))
  }, { immediate: true })
})

const routeTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, laps.value) : undefined)
const climbOccurrences = computed(() => routeData.value ? expandClimbsForLaps(routeData.value, laps.value) : [])
const sprintOccurrences = computed(() => routeData.value ? expandSprintsForLaps(routeData.value, laps.value) : [])

// The lap count the currently displayed combos were computed for - `laps`
// itself moves the header stats immediately, but a speed readout must divide
// a distance by a finish time computed for the SAME lap count. See
// `appliedRide` on `useRecommendRequest`.
const resultsLaps = computed(() => appliedRide.value.laps ?? 1)
const resultsTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, resultsLaps.value) : undefined)

// Tells the open bike drawer whether its bike is still on a loaded page - see `noteRankedFrames`.
const { noteRankedFrames } = useOverlays()
watch(combos, list => noteRankedFrames(list), { immediate: true })

// Whether the team climb pace control is worth showing at all - see the
// `hasLongClimb` prop on `RiderProfileControls`. Deliberately keyed on the
// rider's NORMAL power, never on `tttClimbWkg`: the climb pace must not
// decide its own slider's visibility, or the control vanishes under the
// user's cursor as they drag it.
const hasLongClimb = computed(() => routeData.value
  ? detectLongClimbBlocks(geometryForRouteLaps(routeData.value, resultsLaps.value), powerW.value, weightKg.value).length > 0
  : true)

const surfaceTimePenaltyText = computed(() => routeData.value ? formatSurfaceTimePenalty(routeData.value.surface, topCombo.value?.surfaceTimePenaltySec) : undefined)
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
            <UTooltip text="Metres of climbing per kilometre ridden - the route's average steepness. Under 5 is flat, 10-20 rolling to hilly, above 20 a proper climb.">
              <span class="underline decoration-dotted">Climb ratio</span>
            </UTooltip>
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

    <!-- Directly under the route summary, above the results: this is the
         question the page's title asks, so it reads as the answer to the
         stats just above rather than as a footnote after the grid. It needs
         `topCombo`, so it renders from the prerendered results on first paint
         and only pops in on a client-side navigation. -->
    <div v-if="faqAnswer">
      <h2 class="text-lg font-semibold text-highlighted mb-2">
        {{ faqQuestion }}
      </h2>
      <p class="text-muted">
        {{ faqAnswer }}
      </p>
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
          >{{ raceContextLabel(entry.season, entry.round) }} {{ raceDisplayName(entry.race) }}</ULink>
          ({{ formatRaceDateRange(entry.race.date, entry.race.endDate) }})<span v-if="index < upcomingEvents.length - 1">, </span>
        </span>
      </template>
    </UAlert>

    <div>
      <h2 class="text-xl font-semibold text-highlighted mb-4">
        Best bike &amp; wheel combo for this route
      </h2>
      <RecommendDataNotice />
      <p
        class="sr-only"
        role="status"
        aria-live="polite"
      >
        {{ resultsAnnouncement }}
      </p>
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
          v-if="isRefreshing"
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
          :class="{ 'opacity-60 pointer-events-none': isRefreshing }"
        >
          <ComboResultCard
            v-if="topCombo"
            :load-wheel-options="loadWheelOptions"
            :combo="topCombo"
            :rank="1"
            :route="routeData"
            :laps="resultsLaps"
            :fastest-time-sec="fastestTimeSec"
            :owned="owned"
            class="mb-6"
          />
          <div
            v-if="restCombos.length"
            class="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <ComboResultCard
              v-for="(combo, index) in restCombos"
              :key="`${combo.frame.id}-${combo.wheelset?.key ?? 'fixed'}`"
              :load-wheel-options="loadWheelOptions"
              :combo="combo"
              :rank="index + 2"
              :route="routeData"
              :laps="resultsLaps"
              :fastest-time-sec="fastestTimeSec"
              :owned="owned"
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
  </UContainer>
</template>
