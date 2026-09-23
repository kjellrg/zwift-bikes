<script setup lang="ts">
import type { PublishableRace } from '../../../shared/utils/events'
import type { Ride } from '../../utils/recommendRequest'
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { rideForRoute } from '#shared/utils/recommendRide'
import { routeSilhouette } from '#shared/utils/silhouette'
import { breadcrumbScript, faqScript } from '../../utils/rankingResults'
import { climbCountFact, surfaceShareFacts, type RideFact } from '../../utils/rideFacts'

const route = useRoute()
const slug = computed(() => route.params.slug as string)

// Read-only here: the levers that write them live in `RiderCard` and
// `RideEquipmentFilters`, which bind and persist this same `useState`-backed
// state. `useRecommendRequest` reads it too, and owns
// every refetch it triggers.
const { weightKg, powerW } = useRiderProfile()
const { showUpcomingRaces } = usePreferences()

const laps = ref(1)
const ride = computed<Ride>(() => ({ course: { kind: 'route', slug: slug.value }, laps: laps.value }))
// Handed whole to `RideResults`, which renders everything this page shows
// about the Ranking; what is destructured here is what the page itself is
// still about - its header, its lap count, its Fact row and its course.
const request = useRecommendRequest(() => ride.value, { key: `recommend-route-${slug.value}` })
const {
  ready: recommendReady, recommendData, physics: physicsInfo,
  combos, topCombo, fastestTimeSec, appliedInputs, appliedRanking, appliedRestrictions, appliedRide,
  isFirstLoad, isRefreshing, resultsAnnouncement, bikeSearch, bikeSearchDebounced
} = request

// Fired together (not sequentially): the recommendation depends on the Ride and the rider's own
// stored state (both read inside `useRecommendRequest`), never on the route lookup resolving first.
// The same lookup the request makes for its applied course, under the same key - see `useCourse`.
const { ready: courseReady, course: routeData, error: routeError } = useCourse(() => ride.value.course)
await Promise.all([courseReady, recommendReady])
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

// Titles and the H1 carry the phrase riders search for; "best bike" is kept
// once, in the description, as it is in the answer.
useSeoMeta({
  title: () => routeData.value ? `Fastest bike for ${routeData.value.name} in ${routeData.value.worldName} | ZwiftBikes` : 'ZwiftBikes',
  description: () => routeData.value
    ? `The best bike and wheels for ${routeData.value.name} in ${routeData.value.worldName} - ${metaStats.value} - ranked by predicted finish time for your weight and power.`
    : undefined,
  ogTitle: () => routeData.value ? `Fastest bike for ${routeData.value.name}` : undefined,
  ogDescription: () => routeData.value
    ? `Every Zwift frame and wheelset ranked by finish time on ${routeData.value.name} in ${routeData.value.worldName} - ${metaStats.value}.`
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
    profile: ogProfile(routeSilhouette(routeData.value, 1, { samples: 120 }))
  }, {
    alt: `Fastest bike for ${routeData.value.name} in ${routeData.value.worldName}: the route's profile and its fastest bike and wheel setup`
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

// The Fact row follows the lap count the rider has picked, like the hero:
// both describe the ride chosen, and the finish time catches up with them.
const facts = computed<RideFact[]>(() => {
  const data = routeData.value
  const totals = routeTotals.value
  if (!data || !totals) return []
  const climbs = climbCountFact(new Set(data.terrain.climbs.map(climb => climb.slug)).size, new Set(data.terrain.sprints.map(sprint => sprint.slug)).size)
  return [
    { value: formatDistance(totals.distanceKm), label: totals.leadInDistanceKm > 0 ? 'with the lead-in' : 'distance' },
    { value: formatElevation(totals.elevationM), label: 'of climbing' },
    { value: `${data.terrain.climbRatio.toFixed(1)} m/km`, label: 'climb ratio' },
    ...surfaceShareFacts(data.surface.composition),
    ...(climbs ? [climbs] : [])
  ]
})
/** The lap and lead-in scope as one Ride-only line, when there is either to state. */
const lapScope = computed(() => {
  const totals = routeTotals.value
  if (!routeData.value || !totals || (!routeData.value.lap && totals.leadInDistanceKm <= 0)) return undefined
  const lapsText = `${laps.value} lap${laps.value === 1 ? '' : 's'}`
  if (totals.leadInDistanceKm <= 0) return `${lapsText}.`
  const climbing = totals.leadInElevationM > 0 ? ` with ${formatElevation(totals.leadInElevationM)} of climbing` : ''
  return `${lapsText} plus a ${formatDistance(totals.leadInDistanceKm)} lead-in${climbing}, ridden once.`
})
const surfaceCoverage = computed(() => routeData.value ? surfaceCoverageLine(routeData.value.surface) : undefined)

// The lap count the currently displayed combos were computed for - `laps`
// itself moves the header stats immediately, but a speed readout must divide
// a distance by a finish time computed for the SAME lap count. See
// `appliedRide` on `useRecommendRequest`.
const resultsLaps = computed(() => appliedRide.value?.laps ?? 1)

/** What a report filed from this page says the ranking was ridden as - see `formatRideLine`. */
const reportRideLine = computed(() => formatRideLine({ ride: appliedRide.value, rider: appliedInputs.value }))
const resolvedRide = computed(() => routeData.value ? rideForRoute(routeData.value, resultsLaps.value) : undefined)
const resultsTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, resultsLaps.value) : undefined)

// Whether the team climb pace lever is worth showing at all - see the
// `hasLongClimb` prop on `RiderCard`. Deliberately keyed on the
// rider's NORMAL power, never on `tttClimbWkg`: the climb pace must not
// decide its own slider's visibility, or the control vanishes under the
// user's cursor as they drag it.
const hasLongClimb = computed(() => resolvedRide.value
  ? detectLongClimbBlocks(resolvedRide.value.planGeometry(), powerW.value, weightKg.value).length > 0
  : true)

// One plan for the Fact row's TTT line and the TTT plan tab, from the
// applied results - see `useTttPlan`. Undefined outside TTT drafting.
const tttPlan = useTttPlan({
  route: () => routeData.value,
  combo: () => topCombo.value,
  rider: () => appliedInputs.value,
  laps: () => resultsLaps.value,
  loading: () => isFirstLoad.value
})

// Also handed whole to `RideResults`, so the recommendation and the rows
// pick through one set of picks; the section they are compared in renders
// below, in this page's own flow, which is where "Show comparison" scrolls.
const comparison = useComparison(() => combos.value)
const { picked: comparedCombos, clear: clearComparison, remove: removeFromComparison } = comparison

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
  // The trail is this page's own - a route sits directly under the home page
  // - and the envelope, the keying and the escaping are `rankingResults.ts`'s.
  return {
    script: [
      breadcrumbScript([
        { name: 'Home', item: siteConfig.url },
        { name: routeData.value.name, item: canonicalUrl.value }
      ]),
      faqScript(faqQuestion.value, faqAnswer.value)
    ].filter(script => script !== undefined)
  }
})
</script>

<template>
  <UContainer
    v-if="routeData"
    class="pb-8"
  >
    <RideHeading
      :crumbs="[
        { label: 'All routes', to: '/' },
        { label: routeData.worldName },
        { label: TERRAIN_LABELS[routeData.terrain.category] },
        ...(routeData.eventOnly ? [{ label: 'Event only' }] : [])
      ]"
      :name="routeData.name"
    />

    <!-- `laps` (the picker), not the applied lap count: the Fact row and the
         hero describe the ride the rider has chosen, and are Ride-only. -->
    <RideFactRow :facts="facts">
      <li v-if="lapScope">
        {{ lapScope }}
      </li>
      <li v-if="surfaceCoverage && surfaceCoverage !== 'Mapped surfaces'">
        {{ surfaceCoverage }}.
      </li>
      <!-- Client-only: this page is prerendered, so "upcoming" resolved at
           render time would bake the build date into the HTML. -->
      <li v-if="showUpcomingRaces && upcomingEvents.length">
        Features in upcoming races:
        <template
          v-for="(entry, index) in upcomingEvents"
          :key="entry.path"
        >
          <NuxtLink
            :to="entry.path"
            class="text-toned underline decoration-rule-strong hover:text-highlighted"
          >{{ raceContextLabel(entry.season, entry.round) }} {{ raceDisplayName(entry.race) }}</NuxtLink>
          ({{ formatRaceDateRange(entry.race.date, entry.race.endDate) }})<span v-if="index < upcomingEvents.length - 1">, </span>
        </template>
      </li>
      <TttFactLine
        v-if="tttPlan"
        :plan="tttPlan"
      />
    </RideFactRow>

    <CourseHero
      :route="routeData"
      :laps="laps"
      :name="routeData.name"
    />

    <RecommendDataNotice class="mt-6" />
    <p
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ resultsAnnouncement }}
    </p>

    <RideResults
      :request="request"
      :comparison="comparison"
      :answer="answer"
      :faq-question="faqQuestion"
    >
      <template #rider>
        <RiderCard
          v-model:laps="laps"
          :rider="appliedInputs"
          :refreshing="isRefreshing"
          :has-long-climb="hasLongClimb"
          :lap-options="routeData.lap ? lapOptions : undefined"
          :applied-laps="resultsLaps"
        />
      </template>

      <template #report-link>
        <ReportDataLink
          :item="routeData?.name"
          :ride="reportRideLine"
        />
      </template>
    </RideResults>

    <div class="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-2">
      <RideWhy
        :course="appliedRanking.course"
        :combo="topCombo"
        :ride-name="routeData.name"
        :physics-mode="physicsInfo?.mode"
        :refreshing="isRefreshing"
      />
      <!-- The Ride-only tabs follow the picker `laps` like the hero; the
           equipment views follow the applied results, like the answer. -->
      <RideCourseAnalysis
        :route="routeData"
        :results-route="appliedRanking.course"
        kind="route"
        :laps="laps"
        :results-laps="resultsLaps"
        :combo="topCombo"
        :rider="appliedInputs"
        :refreshing="isRefreshing"
        :loading="isFirstLoad"
        :plan="tttPlan"
      />
    </div>

    <RideComparison
      class="mt-16"
      :combos="comparedCombos"
      :fastest-time-sec="fastestTimeSec"
      @clear="clearComparison"
      @remove="removeFromComparison"
    />

    <RelatedRoutes
      :key="routeData.slug"
      class="mt-16"
      :route="routeData"
    />

    <PhysicsNote
      v-if="physicsInfo"
      class="mt-12"
      :mode="physicsInfo.mode"
      :summary="physicsInfo.summary"
      :note="physicsInfo.note"
    />
  </UContainer>
</template>
