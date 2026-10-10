<script setup lang="ts">
import type { PublishableRace } from '../../../shared/utils/events'
import { routeStatement } from '#shared/utils/rideStatement'
import type { Ride } from '../../utils/recommendRequest'

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const { showUpcomingRaces } = usePreferences()

const laps = ref(1)
const ride = computed<Ride>(() => ({ course: { kind: 'route', slug: slug.value }, laps: laps.value }))

// The route the rider has selected, which the Ride statement, the Fact row
// and the Course hero describe. The same lookup the ranking makes for its
// Applied course, under the same key - see `useCourse`. Declared before the
// ranking page module, whose statement is built from it.
const { ready: courseReady, course: routeData, error: routeError } = useCourse(() => ride.value.course)

const siteConfig = useSiteConfig()
// Everything this page shows about its Ranking - see `useRankingPage` - and
// everything it says about its Ride on its own, in its Ride statement (see
// `routeStatement`). What stays here is the page's selection - its lap count
// - its markup, its related routes and its share card.
const rankingPage = useRankingPage({
  ride: () => ride.value,
  key: `recommend-route-${slug.value}`,
  statement: answer => routeData.value && routeStatement({ route: routeData.value, laps: laps.value, siteUrl: siteConfig.url, answer })
})
const { statement, tttPlan, bikeSearch, bikeSearchDebounced } = rankingPage
// The live Ride resolved, for the Course hero: the laps the picker shows.
const liveRide = useResolvedRide(() => ride.value, () => routeData.value)

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

// The head quotes one lap with the lead-in once, as the share card does, so
// the SERP snippet and the card always quote the same numbers. The
// prerender renders the description for the default rider, as it does the
// answer.
useSeoMeta({
  title: () => statement.value?.title ?? 'ZwiftBikes',
  description: () => statement.value?.description,
  ogTitle: () => statement.value?.ogTitle,
  ogDescription: () => statement.value?.ogDescription
})

// Issue #59: a generated card replaces the old hotlinked world minimap.
// Snapshotted once at setup, which is exactly the build-time prerender pass
// (zeroRuntime never re-renders): rank 1 is therefore the DEFAULT rider
// profile's - the same ranking the prerendered page itself shows - over one
// lap, the lap count a clean link ranks. See `RankingPageShareCard`.
if (statement.value) {
  const { props: card, alt } = statement.value.shareCard
  const { frameName, wheelName, silhouette } = rankingPage.shareCard.value
  defineOgImage('RouteCard', { ...card, frameName, wheelName, profile: silhouette }, { alt })
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
</script>

<template>
  <UContainer
    v-if="routeData && statement"
    class="pb-8"
  >
    <RideHeading
      :crumbs="statement.heading.crumbs"
      :name="statement.heading.name"
    />

    <!-- `laps` (the picker), not the applied lap count: the Fact row and the
         hero describe the ride the rider has chosen, and are Ride-only. -->
    <RideFactRow
      :facts="statement.facts"
      :surface="statement.surface"
    >
      <li v-if="statement.coverageNote">
        {{ statement.coverageNote }}
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
      v-if="liveRide"
      :ride="liveRide"
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
          :item="statement.reportItem"
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
