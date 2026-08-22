<script setup lang="ts">
import type { EventRaceWithRoute } from '../../../../shared/types/events'

const route = useRoute()
const seasonSlug = computed(() => route.params.season as string)

// Calendar metadata comes from the leaf module (no fetch needed); the route
// join - name, world, distance per race - comes from the API, which keeps the
// route surface dataset behind it on the server.
const season = getSeasonBySlug(seasonSlug.value)
if (!season) throw createError({ statusCode: 404, statusMessage: 'Season not found', fatal: true })

const { data: seasonData } = await useFetch(() => `/api/events/${seasonSlug.value}`)

const rounds = computed(() => seasonData.value?.rounds ?? [])
const title = computed(() => `${season.seriesName} ${season.label}`)

/**
 * Resolved in `onMounted`, never at render time: these pages are prerendered,
 * so "next race" and "past" evaluated during the build would be frozen into
 * the shipped HTML and go stale the moment it deploys. SSR and the first
 * client render show every race in its round table (content stays in the DOM
 * for crawlers); past races regroup into the collapsible in a brief
 * post-mount reflow.
 */
// Runtime site flags: with the events section hidden, this page swaps its
// content for the unavailable notice post-mount, and /api/events/** answers
// 503 meanwhile (server/middleware/site-flags-gate.ts) - so the useFetch
// above coming back empty on a client-side visit is expected, not an error.
const { eventsVisible, eventsNotice, load: loadSiteFlags } = useSiteFlags()

const nextRaceSlug = ref<string>()
const pastRaceSlugs = ref(new Set<string>())
onMounted(() => {
  loadSiteFlags()
  const today = new Date().toISOString().slice(0, 10)
  const visible = sortRacesByDate(getVisibleSeasonRaces(season))
  // A week-long stage that's mid-window still counts as the next race.
  nextRaceSlug.value = visible.find(race => raceEndDate(race) >= today)?.slug
  pastRaceSlugs.value = new Set(visible.filter(race => raceEndDate(race) < today).map(race => race.slug))
})

const upcomingRacesForRound = (round: { races: EventRaceWithRoute[] }) => round.races.filter(race => !pastRaceSlugs.value.has(race.slug))
const pastRaces = computed(() => rounds.value.flatMap(round => round.races.filter(race => pastRaceSlugs.value.has(race.slug))))

function raceHref(race: EventRaceWithRoute): string | undefined {
  return isRacePublishable(race) ? `/events/${season!.slug}/${race.slug}` : undefined
}

const siteConfig = useSiteConfig()
const seasonUrl = computed(() => `${siteConfig.url}/events/${season!.slug}`)

useSeoMeta({
  title: () => `${title.value} Schedule - Routes & Best Bikes - ZwiftBikes`,
  description: () => `Every ${title.value} race date and route, with the fastest bike and wheel combo for each one - lap counts and TT bike rules included.`,
  ogTitle: () => `${title.value} schedule`,
  ogDescription: () => season!.description
})

useHead(() => ({
  script: [
    {
      type: 'application/ld+json' as const,
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
          { '@type': 'ListItem', 'position': 2, 'name': 'Race calendars', 'item': `${siteConfig.url}/events` },
          { '@type': 'ListItem', 'position': 3, 'name': title.value, 'item': seasonUrl.value }
        ]
      }).replace(/</g, '\\u003c')
    },
    {
      type: 'application/ld+json' as const,
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        'name': `${title.value} race calendar`,
        'itemListElement': rounds.value.flatMap(round => round.races).map((race, index) => ({
          '@type': 'ListItem',
          'position': index + 1,
          'name': `${raceDisplayName(race)}${race.categories[0]?.route ? ` - ${race.categories[0].route.name}` : ''}`,
          ...(isRacePublishable(race) ? { item: `${seasonUrl.value}/${race.slug}` } : {})
        }))
      }).replace(/</g, '\\u003c')
    }
  ]
}))
</script>

<template>
  <EventsUnavailableNotice
    v-if="!eventsVisible"
    :notice="eventsNotice"
  />
  <UContainer
    v-else
    class="py-10 space-y-10"
  >
    <div>
      <UButton
        to="/events"
        variant="link"
        color="neutral"
        icon="i-lucide-arrow-left"
        class="mb-4 px-0"
      >
        All race calendars
      </UButton>
      <h1 class="text-3xl font-bold text-highlighted">
        {{ title }} schedule
      </h1>
      <p class="text-muted mt-2 max-w-3xl">
        {{ season!.description }}
      </p>
      <p class="text-sm text-muted mt-3">
        Organised by
        <ULink
          v-if="season!.organizerUrl"
          :to="season!.organizerUrl"
          target="_blank"
          rel="noopener"
          class="text-primary underline"
        >{{ season!.organizer }}</ULink>
        <template v-else>
          {{ season!.organizer }}
        </template>. Race dates and routes are theirs; the bike and wheel
        recommendations are ours.
      </p>
    </div>

    <UAlert
      v-if="season!.note"
      color="primary"
      variant="subtle"
      icon="i-lucide-calendar-clock"
      title="Season status"
      :description="season!.note"
    />

    <div
      v-for="round in rounds"
      :key="round.number"
      class="space-y-3"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-xl font-semibold text-highlighted">
          {{ round.name ? `Round ${round.number}: ${round.name}` : `Round ${round.number}` }}
        </h2>
        <p class="text-sm text-muted">
          {{ formatRaceDateShort(round.startDate) }} - {{ formatRaceDateShort(round.endDate) }}
        </p>
      </div>

      <!-- Every race is a row at SSR; rows move to "Past races" post-mount. -->
      <p
        v-if="!upcomingRacesForRound(round).length"
        class="text-sm text-muted"
      >
        All of this round's races have been run - see Past races below.
      </p>
      <div
        v-else
        class="overflow-x-auto rounded-lg border border-default"
      >
        <table class="w-full text-sm">
          <thead class="bg-elevated/50">
            <tr class="text-left text-muted">
              <th class="px-4 py-2 font-medium">
                Week
              </th>
              <th class="px-4 py-2 font-medium">
                Date
              </th>
              <th class="px-4 py-2 font-medium">
                Route
              </th>
              <th class="px-4 py-2 font-medium">
                Format
              </th>
              <th class="px-4 py-2 font-medium">
                Distance
              </th>
              <th class="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="race in upcomingRacesForRound(round)"
              :key="race.slug"
              class="border-t border-default"
              :class="{ 'bg-primary/5': race.slug === nextRaceSlug }"
            >
              <td class="px-4 py-2 whitespace-nowrap">
                {{ race.week }}
                <UBadge
                  v-if="race.slug === nextRaceSlug"
                  color="primary"
                  variant="subtle"
                  size="sm"
                  class="ml-1"
                >
                  Next
                </UBadge>
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                {{ formatRaceDateRange(race.date, race.endDate) }}
              </td>
              <td class="px-4 py-2">
                <template v-if="race.categories.length">
                  <div
                    v-for="group in race.categories"
                    :key="formatCategoryGroup(group)"
                  >
                    <!-- The category prefix only earns its place when the
                         groups actually ride different courses. -->
                    <span
                      v-if="race.categories.length > 1"
                      class="text-muted"
                    >{{ formatCategoryGroup(group) }}:</span>
                    {{ group.routeName ?? group.route?.name ?? 'TBC' }}
                    <span
                      v-if="group.route"
                      class="text-muted"
                    >- {{ group.route.worldName }}</span>
                  </div>
                </template>
                <span
                  v-else
                  class="text-muted"
                >TBC</span>
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                <UBadge
                  v-if="race.format"
                  :color="RACE_FORMAT_COLORS[race.format]"
                  variant="subtle"
                  size="sm"
                >
                  {{ RACE_FORMAT_LABELS[race.format] }}
                </UBadge>
                <span
                  v-else
                  class="text-muted"
                >TBC</span>
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                <template v-if="race.categories.length">
                  <div
                    v-for="group in race.categories"
                    :key="formatCategoryGroup(group)"
                  >
                    <template v-if="group.officialDistanceKm">
                      {{ formatDistance(group.officialDistanceKm) }}
                    </template>
                    <template v-else-if="group.computed">
                      {{ formatDistance(group.computed.distanceKm) }}
                    </template>
                    <span
                      v-else
                      class="text-muted"
                    >-</span>
                  </div>
                </template>
                <span
                  v-else
                  class="text-muted"
                >-</span>
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap">
                <ULink
                  v-if="raceHref(race)"
                  :to="raceHref(race)"
                  class="text-primary underline"
                >
                  Best bike
                </ULink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <UCollapsible v-if="pastRaces.length">
      <UButton
        color="neutral"
        variant="subtle"
        trailing-icon="i-lucide-chevron-down"
      >
        Past races ({{ pastRaces.length }})
      </UButton>
      <template #content>
        <div class="mt-4 overflow-x-auto rounded-lg border border-default">
          <table class="w-full text-sm">
            <thead class="bg-elevated/50">
              <tr class="text-left text-muted">
                <th class="px-4 py-2 font-medium">
                  Race
                </th>
                <th class="px-4 py-2 font-medium">
                  Date
                </th>
                <th class="px-4 py-2 font-medium">
                  Route
                </th>
                <th class="px-4 py-2 font-medium">
                  Format
                </th>
                <th class="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="race in pastRaces"
                :key="race.slug"
                class="border-t border-default"
              >
                <td class="px-4 py-2 whitespace-nowrap">
                  {{ raceDisplayName(race) }}
                </td>
                <td class="px-4 py-2 whitespace-nowrap">
                  {{ formatRaceDateRange(race.date, race.endDate) }}
                </td>
                <td class="px-4 py-2">
                  {{ race.categories.map(group => group.routeName ?? group.route?.name).filter(Boolean).join(' / ') || 'TBC' }}
                </td>
                <td class="px-4 py-2 whitespace-nowrap">
                  <UBadge
                    v-if="race.format"
                    :color="RACE_FORMAT_COLORS[race.format]"
                    variant="subtle"
                    size="sm"
                  >
                    {{ RACE_FORMAT_LABELS[race.format] }}
                  </UBadge>
                </td>
                <td class="px-4 py-2 text-right whitespace-nowrap">
                  <ULink
                    v-if="raceHref(race)"
                    :to="raceHref(race)"
                    class="text-primary underline"
                  >
                    Best bike
                  </ULink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </UCollapsible>

    <EventsDisclaimer
      :organizer="season!.organizer"
      :organizer-url="season!.organizerUrl"
    />
  </UContainer>
</template>
