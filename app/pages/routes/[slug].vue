<script setup lang="ts">
import type { PublishableRace } from '../../../shared/utils/events'
import type { Ride } from '../../utils/recommendRequest'
import { climbCountFact, distanceLabel, surfaceSplit, type RideFact } from '../../utils/rideFacts'

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const { showUpcomingRaces } = usePreferences()

const laps = ref(1)
const ride = computed<Ride>(() => ({ course: { kind: 'route', slug: slug.value }, laps: laps.value }))

// The route the rider has selected, which the header, the Fact row and the
// Course hero describe. The same lookup the ranking makes for its Applied
// course, under the same key - see `useCourse`. Declared before the ranking
// page module, whose head and answer read the page's own wording from it.
const { ready: courseReady, course: routeData, error: routeError } = useCourse(() => ride.value.course)

const siteConfig = useSiteConfig()
const canonicalUrl = useCanonicalUrl()
// Everything this page shows about its Ranking - see `useRankingPage`. What
// stays here is what the page states itself: its header, its lap count, its
// Fact row and Course hero, its related routes and its share card.
const rankingPage = useRankingPage({
  ride: () => ride.value,
  key: `recommend-route-${slug.value}`,
  rideName: course => `${course.name} in ${course.worldName}`,
  faqQuestion: () => routeData.value ? `What's the fastest bike for ${routeData.value.name}?` : undefined,
  // A route sits directly under the home page.
  breadcrumbs: () => routeData.value
    ? [
        { name: 'Home', item: siteConfig.url },
        { name: routeData.value.name, item: canonicalUrl.value }
      ]
    : undefined
})
const { tttPlan, bikeSearch, bikeSearchDebounced } = rankingPage

// Fired together (not sequentially): the recommendation depends on the Ride and the rider's own
// stored state, never on the route lookup resolving first.
await Promise.all([courseReady, rankingPage.ready])
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

// Titles and the H1 carry the phrase riders search for; "best bike" leads
// the description, which then names rank 1 - see `rideDescription`. The
// prerender renders it for the default rider, as it does the answer.
const metaDescription = computed(() => {
  if (!routeData.value) return undefined
  const totals = computeRouteTotals(routeData.value, 1)
  return rideDescription({
    ride: routeData.value.name,
    world: routeData.value.worldName,
    stats: `${formatDistance(totals.distanceKm)}, ${formatElevation(totals.elevationM)} of climbing`,
    setup: rankingPage.request.topCombo.value ? setupName(rankingPage.request.topCombo.value) : undefined,
    category: rankingPage.request.appliedInputs.value.category
  })
})
useSeoMeta({
  title: () => routeData.value ? `Fastest bike for ${routeData.value.name} in ${routeData.value.worldName} | ZwiftBikes` : 'ZwiftBikes',
  description: metaDescription,
  ogTitle: () => routeData.value ? `Fastest bike for ${routeData.value.name}` : undefined,
  ogDescription: () => routeData.value
    ? `Every Zwift frame and wheelset ranked by finish time on ${routeData.value.name} in ${routeData.value.worldName} - ${metaStats.value}.`
    : undefined
})

// Issue #59: a generated card replaces the old hotlinked world minimap.
// Snapshotted once at setup, which is exactly the build-time prerender pass
// (zeroRuntime never re-renders): rank 1 is therefore the DEFAULT rider
// profile's - the same ranking the prerendered page itself shows - over one
// lap, the lap count a clean link ranks. See `RankingPageShareCard`.
if (routeData.value) {
  const totals = computeRouteTotals(routeData.value, 1)
  const { frameName, wheelName, silhouette } = rankingPage.shareCard.value
  defineOgImage('RouteCard', {
    title: routeData.value.name,
    world: routeData.value.worldName,
    distance: formatDistance(totals.distanceKm),
    elevation: formatElevation(totals.elevationM),
    frameName,
    wheelName,
    profile: silhouette
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
    { value: formatDistance(totals.distanceKm), label: data.lap || totals.leadInDistanceKm > 0 ? distanceLabel({ laps: laps.value, leadInKm: totals.leadInDistanceKm }) : 'distance' },
    { value: formatElevation(totals.elevationM), label: 'of climbing' },
    { value: `${data.terrain.climbRatio.toFixed(1)} m/km`, label: 'climb ratio' },
    ...(climbs ? [climbs] : [])
  ]
})
const surface = computed(() => routeData.value ? surfaceSplit(routeData.value.surface.composition) : undefined)
const surfaceCoverage = computed(() => routeData.value ? surfaceCoverageLine(routeData.value.surface) : undefined)
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
    <RideFactRow
      :facts="facts"
      :surface="surface"
    >
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

    <RankingPageBody :page="rankingPage">
      <template #rider="card">
        <RiderCard
          v-model:laps="laps"
          :rider="card.rider"
          :refreshing="card.refreshing"
          :has-long-climb="card.hasLongClimb"
          :lap-options="routeData.lap ? lapOptions : undefined"
          :applied-laps="card.appliedLaps"
        />
      </template>

      <template #report-link="{ reportLine }">
        <ReportDataLink
          :item="routeData?.name"
          :ride="reportLine"
        />
      </template>

      <template #related>
        <RelatedRoutes
          :key="routeData.slug"
          class="mt-16"
          :route="routeData"
        />
      </template>
    </RankingPageBody>
  </UContainer>
</template>
