<script setup lang="ts">
import type { EventSeason } from '../../../shared/utils/events'

/**
 * The Discovery page for Seasons (see `CONTEXT.md`): every racing calendar
 * this site covers, grouped by series and newest first. It ranks nothing and
 * has no filters - what it shows about a season is its identity and the
 * numbers a rider scans to pick one.
 *
 * Imports the calendar module directly rather than fetching it -
 * `shared/utils/events` is a leaf (plain dates and strings, no route surface
 * data), so there's nothing here worth an API round trip.
 */
const seasons = getSeasons()

/**
 * Seasons within a series, newest first - `sortSeasonsNewestFirst` asks the
 * round dates, since the files are written oldest first and `label` is the
 * organiser's own string ("2026/27", "2026"), which sorts nothing.
 */
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
  return [...bySeries.values()].map(group => ({ ...group, seasons: sortSeasonsNewestFirst(group.seasons) }))
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
const pastSeasons = computed(() => sortSeasonsNewestFirst(seasons.filter(isPastSeason)))

const siteConfig = useSiteConfig()

useSeoMeta({
  title: 'Zwift Race Calendars - Best Bike per Race - ZwiftBikes',
  description: 'Race dates, routes and the fastest bike and wheel combo for every round of Zwift Racing League and every ZRacing stage.',
  ogTitle: 'Zwift race calendars',
  ogDescription: 'Race dates, routes and the fastest bike and wheel combo for every round of Zwift Racing League and every ZRacing stage.'
})

defineOgImage('SiteCard', {}, { alt: 'ZwiftBikes - the fastest bike and wheelset for every race on the Zwift calendar' })

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

    <!-- The same teaser the homepage carries, and for the same reason: the
         one race a rider is most likely here for is the next one, and it is
         otherwise several rounds down a season page. It resolves and hides
         itself (teasers off, section gated, calendars run dry). -->
    <NextRaceCard />

    <!-- Reachable by hiding every season - rare, but an empty page with a
         heading and nothing under it reads as broken rather than deliberate. -->
    <p
      v-if="!seasons.length"
      class="text-muted"
    >
      No race calendars are being tracked at the moment. Check back when the next season is announced.
    </p>

    <!-- A series whose every season has finished goes with its seasons into
         the collapsible below: a heading with nothing under it reads as
         broken, the same rule the segments page applies to a world a filter
         empties. -->
    <div
      v-for="series in seriesGroups.filter(group => group.seasons.some(season => !isPastSeason(season)))"
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

      <div class="grid grid-cols-1 gap-4">
        <SeasonCard
          v-for="season in series.seasons.filter(s => !isPastSeason(s))"
          :key="season.slug"
          :season="season"
        />
      </div>
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
        <div class="mt-4 grid grid-cols-1 gap-4">
          <SeasonCard
            v-for="season in pastSeasons"
            :key="season.slug"
            :season="season"
          />
        </div>
      </template>
    </UCollapsible>

    <EventsDisclaimer />
  </UContainer>
</template>
