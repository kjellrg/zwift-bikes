<script setup lang="ts">
import type { PublishableRace } from '../../../shared/utils/events'
import type { Ride } from '../../utils/recommendRequest'
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { rideForRoute } from '#shared/utils/recommendRide'
import { expandClimbsForLaps } from '#shared/utils/routeOccurrences'

const route = useRoute()
const slug = computed(() => route.params.slug as string)

// Read-only here: the controls that write them live in
// `RiderProfileControls` / `RideEquipmentFilters`, which bind and persist this
// same `useState`-backed state. `useRecommendRequest` reads it too, and owns
// every refetch it triggers.
const { weightKg, powerW } = useRiderProfile()
const { showUpcomingRaces, setBikeCategory, setIncludeHaloBikes } = usePreferences()

const laps = ref(1)
const ride = computed<Ride>(() => ({ endpoint: `/api/recommend/${slug.value}`, laps: laps.value }))
const {
  ready: recommendReady, recommendData, physics: physicsInfo, fastestOverall,
  combos, topCombo, fastestTimeSec, hasMore, loadingMore, showMore,
  appliedInputs, appliedRestrictions, canShowMore,
  appliedRide, hasRanking, isFirstLoad, isRefreshing, refreshFailed, expansionFailed, retry,
  resultsAnnouncement, bikeSearch, bikeSearchDebounced, loadWheelOptions, serializedQuery
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

// `?laps=3&bike=tarmac&category=tt&draft=ttt` - see `useSharedView`. Laps
// count from one, so `?laps=1` is the clean URL this page's link keeps.
useSharedView({ bikeSearch, bikeSearchDebounced }, { key: 'laps', value: laps, min: 1, max: () => lapOptions.value.length })

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
    profile: ogProfileFromPoints(rideForRoute(routeData.value, 1).planGeometry().points)
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

// The lap count the currently displayed combos were computed for - `laps`
// itself moves the header stats immediately, but a speed readout must divide
// a distance by a finish time computed for the SAME lap count. See
// `appliedRide` on `useRecommendRequest`.
const resultsLaps = computed(() => appliedRide.value.laps ?? 1)

/** What a report filed from this page says the ranking was ridden as - see `formatRideLine`. */
const reportRideLine = computed(() => formatRideLine({ ride: appliedRide.value, rider: appliedInputs.value }))
const resolvedRide = computed(() => routeData.value ? rideForRoute(routeData.value, resultsLaps.value) : undefined)
const resultsTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, resultsLaps.value) : undefined)

// Tells the open bike drawer whether its bike is still on a loaded page - see `noteRankedFrames`.
const { noteRankedFrames } = useOverlays()
watch(combos, list => noteRankedFrames(list), { immediate: true })

// Whether the team climb pace control is worth showing at all - see the
// `hasLongClimb` prop on `RiderProfileControls`. Deliberately keyed on the
// rider's NORMAL power, never on `tttClimbWkg`: the climb pace must not
// decide its own slider's visibility, or the control vanishes under the
// user's cursor as they drag it.
const hasLongClimb = computed(() => resolvedRide.value
  ? detectLongClimbBlocks(resolvedRide.value.planGeometry(), powerW.value, weightKg.value).length > 0
  : true)

const surfaceTimePenaltyText = computed(() => routeData.value ? formatSurfaceTimePenalty(routeData.value.surface, topCombo.value?.surfaceTimePenaltySec) : undefined)
const physicsIsDynamic = computed(() => physicsInfo.value?.mode === 'dynamic')
const tttSavingText = computed(() => formatTttTimeSaving(physicsInfo.value?.ttt))
const raceSavingText = computed(() => formatRaceTimeSaving(physicsInfo.value?.race))
// The evidence lines under the recommended time - each is about the fastest
// combo, so they sit with it rather than under the route header.
const recommendationNotes = computed(() => [surfaceTimePenaltyText.value, tttSavingText.value, raceSavingText.value]
  .filter((note): note is string => Boolean(note)))
const limitedDataNote = computed(() => routeData.value
  ? limitedCourseDataNote({
      hasElevationProfile: (routeData.value.terrain.elevationProfile?.length ?? 0) > 1,
      hasSurfaceLocations: (routeData.value.surface.segments?.length ?? 0) > 0
    })
  : undefined)
// One plan for the briefing's TTT line and the TTT plan tab, from the
// applied results - see `useTttPlan`. Undefined outside TTT drafting.
const tttPlan = useTttPlan({
  route: () => routeData.value ?? undefined,
  combo: () => topCombo.value,
  rider: () => appliedInputs.value,
  laps: () => resultsLaps.value,
  loading: () => isFirstLoad.value
})

const {
  keys: comparisonKeys, picked: comparedCombos, full: comparisonFull,
  includes: isCompared, toggle: toggleCompared,
  clear: clearComparison, remove: removeFromComparison
} = useComparison(() => combos.value)

const faqQuestion = computed(() => routeData.value ? `What's the fastest bike for ${routeData.value.name}?` : undefined)
// The visible answer under the recommendation and the FAQ structured data
// are one text (`answer.text`), built from the APPLIED ranking - the lagged
// lap count and the rider the request was actually answered for - so what a
// crawler reads is what a rider sees. Renders from the prerendered results
// on first paint; during a refetch it keeps describing the results still on
// screen, the same way the dimmed results do.
const answer = useRecommendationAnswer({
  combo: () => topCombo.value,
  rideName: () => routeData.value ? `${routeData.value.name} in ${routeData.value.worldName}` : undefined,
  distanceKm: () => resultsTotals.value?.distanceKm ?? routeData.value?.distance,
  rider: () => appliedInputs.value,
  laps: () => resultsLaps.value,
  restrictions: () => appliedRestrictions.value
})
const faqAnswer = computed(() => answer.value?.text)

const siteConfig = useSiteConfig()
const canonicalUrl = useCanonicalUrl()
useHead(() => {
  if (!routeData.value) return {}
  // Keyed, so unhead updates the server-rendered tag in place. Without a
  // key it matches by content hash, and a patch that lands while the page
  // is still hydrating - the stored profile's ranking is accepted - inserts a second FAQ script and
  // leaves the crawler-facing default-rider one in the document.
  const scripts = [{
    key: 'breadcrumbs',
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
  <UContainer
    v-if="routeData"
    class="py-8 space-y-8"
  >
    <div class="space-y-6">
      <div class="flex flex-wrap items-center gap-3 text-sm text-muted">
        <UButton
          to="/"
          variant="link"
          color="neutral"
          icon="i-lucide-arrow-left"
          class="px-0"
        >
          All routes
        </UButton>
        <span class="border-l border-default pl-3">{{ routeData.worldName }} / route</span>
      </div>
      <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
            Your next ride
          </p>
          <h1 class="mt-1 text-3xl font-bold text-highlighted break-words sm:text-4xl">
            {{ routeData.name }}
          </h1>
          <div class="mt-3 flex flex-wrap gap-2">
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
          </div>
        </div>
        <!-- `routeTotals` follows the lap picker immediately; the finish time
             below follows once the refetch for that lap count lands. -->
        <dl class="grid shrink-0 grid-cols-3 gap-4 sm:gap-8">
          <div>
            <dt class="text-xs text-muted">
              Total distance
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ formatDistance(routeTotals?.distanceKm ?? routeData.distance) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Elevation
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ formatElevation(routeTotals?.elevationM ?? routeData.elevation) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              <UTooltip text="Metres of climbing per kilometre ridden - the route's average steepness. Under 5 is flat, 10-20 rolling to hilly, above 20 a proper climb.">
                <span class="underline decoration-dotted">Climb ratio</span>
              </UTooltip>
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ routeData.terrain.climbRatio.toFixed(1) }} m/km
            </dd>
          </div>
        </dl>
      </div>
      <div
        v-if="routeData.lap || routeData.leadInDistance"
        class="flex flex-wrap items-end gap-4"
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
            aria-label="Laps"
          />
        </div>
        <p
          v-if="routeTotals && routeTotals.leadInDistanceKm > 0"
          class="pb-2 text-sm text-muted"
        >
          <span class="font-medium text-highlighted">Lead-in:</span> {{ formatDistance(routeTotals.leadInDistanceKm) }}<template v-if="routeTotals.leadInElevationM > 0">
            / {{ formatElevation(routeTotals.leadInElevationM) }}
          </template> (ridden once, not repeated per lap)
        </p>
      </div>
      <RideRiderSummary
        :rider="appliedInputs"
        :refreshing="isRefreshing"
        :has-long-climb="hasLongClimb"
      />
      <RideEquipmentFilters :applied-restrictions="appliedRestrictions" />
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

    <RideRefreshNotice
      :failed="refreshFailed"
      :has-results="hasRanking"
      @retry="retry"
    />

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
          <RideRecommendationSkeleton />
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
            :class="{ 'opacity-60': isRefreshing }"
          >
            <RideRecommendation
              v-if="topCombo"
              :combo="topCombo"
              :route="routeData"
              :laps="resultsLaps"
              :fastest-time-sec="fastestTimeSec"
              :load-wheel-options="loadWheelOptions"
              :request-key="serializedQuery"
              :limited-data-note="limitedDataNote"
              :notes="recommendationNotes"
              :compared="isCompared(topCombo)"
              :compare-disabled="comparisonFull && !isCompared(topCombo)"
              :compare-count="comparisonKeys.length"
              @toggle-compare="toggleCompared(topCombo)"
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
                <template v-if="appliedRestrictions.search">
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
      <!-- `laps` (the picker), not `resultsLaps`: the briefing describes the
           ride the rider has chosen, and the climbs are expanded for it. -->
      <RideBriefing
        v-if="routeTotals"
        :route="routeData"
        :kind="TERRAIN_LABELS[routeData.terrain.category]"
        per-lap
        class="lg:col-start-1 lg:row-start-1"
      >
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
      </RideBriefing>
    </div>

    <!-- Full width beneath both columns: the answer the page's title asks
         for, with its assumptions on a smaller line. Inside the
         recommendation column it drove the row's height and left the
         briefing beside acres of whitespace. -->
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

    <div
      v-if="!isFirstLoad"
      class="transition-opacity"
      :class="{ 'opacity-60': isRefreshing }"
    >
      <RideAlternatives
        v-model:search="bikeSearch"
        v-model:selected="comparisonKeys"
        :combos="combos"
        :route="routeData"
        :laps="resultsLaps"
        :fastest-time-sec="fastestTimeSec"
        :load-wheel-options="loadWheelOptions"
        :request-key="serializedQuery"
        :has-more="hasMore"
        :can-show-more="canShowMore"
        :applied-search="appliedRestrictions.search"
        :loading-more="loadingMore"
        :expansion-failed="expansionFailed"
        @show-more="showMore"
      />
      <ReportDataLink
        :item="routeData?.name"
        :ride="reportRideLine"
      />
    </div>

    <!-- Ride-only tabs follow the picker `laps` like the briefing; the
         equipment tabs follow the applied results, like the recommendation. -->
    <RideCourseAnalysis
      :route="routeData"
      kind="route"
      :laps="laps"
      :results-laps="resultsLaps"
      :combo="topCombo"
      :rider="appliedInputs"
      :refreshing="isRefreshing"
      :loading="isFirstLoad"
      :plan="tttPlan"
    />

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
  </UContainer>
</template>
