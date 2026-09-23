<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import { routeSilhouette } from '#shared/utils/silhouette'
import { buildRecommendQuery, recommendEndpoint, rideRulesForFormat, type Ride } from '../utils/recommendRequest'
import { curatedExampleRoute, exampleRiderInputs, exampleRiderLabel, type ExampleRider } from '../utils/homeExample'

/**
 * The homepage's live example: one real route, its Silhouette, its fastest
 * setup and the finish time, so a visitor sees the product doing its job
 * before browsing.
 *
 * Prerendered for the build date's curated route and the default rider,
 * through the recommend endpoint a route page uses, so the indexed homepage
 * carries a real answer. Once mounted it asks again for what is actually
 * current: the next upcoming race's route (its first Category group, at that
 * group's lap count, under the race's format rules) when a race is coming
 * up, or today's curated route by the visitor's own date otherwise - and for
 * the visitor's own rider when they have stored one. The card keeps its
 * size through the swap; a failed swap keeps the prerendered answer.
 *
 * The payload carries only what the card draws, never the route or the
 * ranking whole.
 */

interface ExampleCard {
  href: string
  /** What the example is: "Today's example", or the race and group it is for. */
  context: string
  routeName: string
  worldName: string
  distanceKm: number
  elevationM: number
  frameName: string
  wheelName?: string
  finishTimeSec: number
  riderLabel: string
  shape: ReturnType<typeof routeSilhouette>
}

const CARD_SAMPLES = 96

const profile = useRiderProfile()
const preferences = usePreferences()
const { eventsVisible, load: loadSiteFlags } = useSiteFlags()

function currentRider(): ExampleRider {
  return {
    weightKg: profile.weightKg.value,
    heightCm: profile.heightCm.value,
    powerW: profile.powerW.value,
    sprintPowerW: profile.sprintPowerW.value,
    defaultUnownedLevel: profile.defaultUnownedLevel.value,
    draftMode: profile.draftMode.value,
    tttRiders: profile.tttRiders.value,
    tttClimbWkg: profile.tttClimbWkg.value,
    verifiedOnly: preferences.verifiedOnly.value,
    bikeCategory: preferences.bikeCategory.value,
    includeHaloBikes: preferences.includeHaloBikes.value
  }
}

async function answer(ride: Ride, context: string, href: string, rider: ExampleRider, stored: boolean): Promise<ExampleCard | undefined> {
  const laps = ride.laps ?? 1
  const [route, ranking] = await Promise.all([
    $fetch<RouteWithMeta>(`/api/routes/${ride.course.slug}`),
    $fetch<{ combos: ComboScore[] }>(recommendEndpoint(ride.course), { query: buildRecommendQuery(exampleRiderInputs(rider), ride) })
  ])
  const top = ranking.combos[0]
  if (!top || top.finishTimeSec === undefined) return undefined
  const totals = computeRouteTotals(route, laps)
  return {
    href,
    context,
    routeName: route.name,
    worldName: route.worldName,
    distanceKm: totals.distanceKm,
    elevationM: totals.elevationM,
    frameName: top.frame.name,
    wheelName: top.wheelset?.name,
    finishTimeSec: top.finishTimeSec,
    riderLabel: exampleRiderLabel(rider, stored),
    shape: routeSilhouette(route, laps, { samples: CARD_SAMPLES })
  }
}

// The build date's route, decided on the server and read back from the
// payload, so hydration draws exactly what was prerendered.
const buildDateSlug = useState('home-example-slug', () => curatedExampleRoute(new Date().toISOString().slice(0, 10)))
const { data: prerendered } = await useAsyncData('home-example', () => answer(
  { course: { kind: 'route', slug: buildDateSlug.value }, laps: 1 },
  'Today\'s example',
  `/routes/${buildDateSlug.value}`,
  currentRider(),
  false
))

const current = shallowRef<ExampleCard>()
const card = computed(() => current.value ?? prerendered.value ?? undefined)

onMounted(async () => {
  profile.load()
  preferences.load()
  await loadSiteFlags()
  const today = new Date().toISOString().slice(0, 10)
  const stored = profile.hasStoredProfile.value
  const next = preferences.showUpcomingRaces.value && eventsVisible.value ? getNextUpcomingRace(today) : undefined
  const group = next?.race.categories.find(candidate => candidate.routeSlug)
  let ride: Ride
  let context: string
  let href: string
  if (next && group?.routeSlug) {
    ride = { course: { kind: 'route', slug: group.routeSlug }, laps: group.laps, ...rideRulesForFormat(next.race.format) }
    context = `Next race: ${raceDisplayName(next.race)}, ${formatCategoryGroup(group)}`
    href = next.path
  } else {
    const slug = curatedExampleRoute(today)
    // Nothing to ask again: the prerendered answer is already today's route
    // for the default rider.
    if (slug === buildDateSlug.value && !stored) return
    ride = { course: { kind: 'route', slug }, laps: 1 }
    context = 'Today\'s example'
    href = `/routes/${slug}`
  }
  try {
    current.value = await answer(ride, context, href, currentRider(), stored) ?? current.value
  } catch {
    // The prerendered answer stays: a teaser that failed to refresh is
    // still a true answer for the route it names.
  }
})
</script>

<template>
  <NuxtLink
    v-if="card"
    id="home-example"
    :to="card.href"
    class="block rounded-2xl border border-default bg-elevated px-5 pt-4.5 pb-5 shadow-card transition-colors hover:border-accented"
  >
    <span class="flex justify-between gap-3 text-sm text-muted">
      <span class="min-w-0 truncate">{{ card.context }} · {{ card.worldName }}</span>
      <span class="shrink-0 text-primary">See the ranking</span>
    </span>
    <span class="mt-0.5 block text-xl font-semibold font-heading text-highlighted">{{ card.routeName }}</span>
    <RouteSilhouette
      :shape="card.shape"
      strip
      class="mt-3 h-24"
    />
    <span class="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-t border-default pt-3.5">
      <span class="min-w-0">
        <span class="block text-sm font-semibold text-primary">Fastest setup</span>
        <span class="mt-0.5 block text-lg font-semibold font-heading leading-tight text-highlighted">{{ card.frameName }}</span>
        <span
          v-if="card.wheelName"
          class="block text-sm text-muted"
        >{{ card.wheelName }}</span>
      </span>
      <span class="text-right">
        <span class="block text-[2.75rem] leading-none font-semibold font-timing text-highlighted">{{ formatDuration(card.finishTimeSec) }}</span>
        <span class="mt-1 block text-xs text-muted">{{ formatDistance(card.distanceKm) }} · {{ formatElevation(card.elevationM) }}</span>
      </span>
    </span>
    <span class="mt-3 block text-xs text-muted">{{ card.riderLabel }}</span>
  </NuxtLink>
</template>
