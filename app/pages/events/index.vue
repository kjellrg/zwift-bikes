<script setup lang="ts">
import type { EventSeason } from '../../../shared/utils/events'

/**
 * Hub for the racing calendars this site covers, grouped by series. Imports
 * the calendar module directly rather than fetching it -
 * `shared/utils/events` is a leaf (plain dates and strings, no route surface
 * data), so there's nothing here worth an API round trip.
 */
const seasons = getSeasons()

/** Season order within a series: newest label first, so the current season leads. */
const seriesGroups = computed(() => {
  const bySeries = new Map<string, { seriesSlug: string, seriesName: string, organizer: string, organizerUrl?: string, seasons: EventSeason[] }>()
  for (const season of seasons) {
    const group = bySeries.get(season.seriesSlug) ?? {
      seriesSlug: season.seriesSlug,
      seriesName: season.seriesName,
      organizer: season.organizer,
      organizerUrl: season.organizerUrl,
      seasons: []
    }
    group.seasons.push(season)
    bySeries.set(season.seriesSlug, group)
  }
  return [...bySeries.values()]
})

/**
 * Fully-past seasons collapse out of the way. Resolved in `onMounted`, never
 * at render time: this page is prerendered, so "past" evaluated during the
 * build would be frozen into the shipped HTML. SSR and the first client
 * render show every season in place (content stays in the DOM for crawlers);
 * the regrouping is a brief post-mount reflow.
 */
// Runtime site flags: with the events section hidden, this page swaps its
// content for the unavailable notice post-mount (the prerendered HTML always
// carries the content - same discipline as the "past seasons" regrouping
// below). The section's data endpoints 503 meanwhile, so this isn't just
// cosmetic - see server/middleware/site-flags-gate.ts.
const { eventsVisible, eventsNotice, load: loadSiteFlags } = useSiteFlags()

const pastSeasonSlugs = ref(new Set<string>())
onMounted(() => {
  loadSiteFlags()
  const today = new Date().toISOString().slice(0, 10)
  pastSeasonSlugs.value = new Set(seasons
    .filter(season => getVisibleSeasonRaces(season).every(race => raceEndDate(race) < today))
    .map(season => season.slug))
})
const isPastSeason = (season: EventSeason) => pastSeasonSlugs.value.has(season.slug)
const pastSeasons = computed(() => seasons.filter(isPastSeason))

const siteConfig = useSiteConfig()

useSeoMeta({
  title: 'Zwift Race Calendars - Best Bike per Race - ZwiftBikes',
  description: 'Race dates, routes and the fastest bike and wheel combo for every round of Zwift Racing League and every ZRacing stage.',
  ogTitle: 'Zwift race calendars',
  ogDescription: 'Race dates, routes and the fastest bike and wheel combo for every round of Zwift Racing League and every ZRacing stage.'
})

useHead({
  script: [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
        { '@type': 'ListItem', 'position': 2, 'name': 'Race calendars', 'item': `${siteConfig.url}/events` }
      ]
    }).replace(/</g, '\\u003c')
  }]
})
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
        to="/"
        variant="link"
        color="neutral"
        icon="i-lucide-arrow-left"
        class="mb-4 px-0"
      >
        Back to all routes
      </UButton>
      <h1 class="text-3xl font-bold text-highlighted">
        Zwift race calendars
      </h1>
      <p class="text-muted mt-2 max-w-2xl">
        Every race day, the route it's run on, and the bike and wheel combo our physics model makes
        fastest for it - with the lap count and equipment rules the organisers actually set.
      </p>
    </div>

    <!-- Reachable by hiding every season - rare, but an empty page with a
         heading and nothing under it reads as broken rather than deliberate. -->
    <p
      v-if="!seasons.length"
      class="text-muted"
    >
      No race calendars are being tracked at the moment. Check back when the next season is announced.
    </p>

    <div
      v-for="series in seriesGroups"
      :key="series.seriesSlug"
      class="space-y-4"
    >
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 class="text-2xl font-semibold text-highlighted">
          {{ series.seriesName }}
        </h2>
        <!-- Linked when the organiser's page is known: we complement the
             original sources, so send riders back to them for signup and
             rules. Omitted entirely otherwise. -->
        <UBadge
          v-if="series.organizerUrl"
          color="neutral"
          variant="subtle"
        >
          <ULink
            :to="series.organizerUrl"
            target="_blank"
            rel="noopener"
            class="hover:text-primary"
          >{{ series.organizer }}</ULink>
        </UBadge>
        <UBadge
          v-else
          color="neutral"
          variant="subtle"
        >
          {{ series.organizer }}
        </UBadge>
      </div>

      <UCard
        v-for="season in series.seasons.filter(s => !isPastSeason(s))"
        :key="season.slug"
      >
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h3 class="text-xl font-semibold text-highlighted">
              <ULink
                :to="`/events/${season.slug}`"
                class="hover:text-primary"
              >
                {{ season.seriesName }} {{ season.label }}
              </ULink>
            </h3>
            <p class="text-muted mt-1 max-w-2xl">
              {{ season.description }}
            </p>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div
            v-for="round in season.rounds"
            :key="round.number"
            class="rounded-lg border border-default p-3"
          >
            <p class="text-xs text-muted uppercase tracking-wide">
              Round {{ round.number }}
            </p>
            <p class="font-medium text-highlighted">
              {{ round.name ?? `Round ${round.number}` }}
            </p>
            <p class="text-sm text-muted">
              {{ formatRaceDateShort(round.startDate) }} - {{ formatRaceDateShort(round.endDate) }}
            </p>
          </div>
        </div>

        <div class="mt-4">
          <UButton
            :to="`/events/${season.slug}`"
            color="primary"
            variant="subtle"
            trailing-icon="i-lucide-arrow-right"
          >
            See the {{ season.label }} calendar
          </UButton>
        </div>
      </UCard>
    </div>

    <UCollapsible v-if="pastSeasons.length">
      <UButton
        color="neutral"
        variant="subtle"
        trailing-icon="i-lucide-chevron-down"
      >
        Past seasons ({{ pastSeasons.length }})
      </UButton>
      <template #content>
        <div class="mt-4 space-y-4">
          <UCard
            v-for="season in pastSeasons"
            :key="season.slug"
          >
            <h3 class="text-lg font-semibold text-highlighted">
              <ULink
                :to="`/events/${season.slug}`"
                class="hover:text-primary"
              >
                {{ season.seriesName }} {{ season.label }}
              </ULink>
            </h3>
            <p class="text-muted mt-1">
              {{ season.description }}
            </p>
          </UCard>
        </div>
      </template>
    </UCollapsible>

    <EventsDisclaimer />
  </UContainer>
</template>
