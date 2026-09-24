<script setup lang="ts">
import type { EventSeason } from '../../../shared/utils/events'

/**
 * The Discovery page for Seasons (see `CONTEXT.md`): every racing calendar
 * this site covers that still has races to run, grouped by series and newest
 * first. It ranks nothing and
 * has no filters - what it shows about a season is its identity and the
 * numbers a rider scans to pick one.
 *
 * Imports the calendar module directly rather than fetching it -
 * `shared/utils/events` is a leaf (plain dates and strings, no route surface
 * data), so there's nothing here worth an API round trip.
 */
const seasons = getSeasons()

// Runtime site flags: with the events section hidden, this page swaps its
// content for the unavailable notice post-mount (the prerendered HTML always
// carries the content). The section's data endpoints 503 meanwhile, so this
// isn't just cosmetic - see server/middleware/site-flags-gate.ts.
const { eventsVisible, eventsNotice, load: loadSiteFlags } = useSiteFlags()
onMounted(loadSiteFlags)

/**
 * The build's day while this page is prerendered, the rider's once it is on
 * their screen - see `useToday`. Handed to the season cards too, so a card
 * never asks a clock of its own.
 */
const today = useToday()

/**
 * Seasons still being run, grouped by series, newest first. A Season whose
 * every Race has been run is not listed at all (`seasonHasBeenRun`), and a
 * series with none left goes with it: this page gets a rider to a race they
 * can still ride, and a heading with nothing under it reads as broken.
 *
 * `sortSeasonsNewestFirst` asks the round dates, since the files are written
 * oldest first and `label` is the organiser's own string ("2026/27",
 * "2026"), which sorts nothing.
 */
const seriesGroups = computed(() => {
  const bySeries = new Map<string, { seriesSlug: string, seriesName: string, organizer: string, organizerUrl?: string, seasons: EventSeason[] }>()
  for (const season of seasons.filter(season => !seasonHasBeenRun(season, today.value))) {
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

const siteConfig = useSiteConfig()

useSeoMeta({
  title: 'The fastest bike for every Zwift race | ZwiftBikes',
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
    class="pb-8"
  >
    <div class="pt-8 sm:pt-12">
      <nav aria-label="Breadcrumb">
        <ol class="flex flex-wrap gap-x-3.5 text-sm text-muted">
          <li>
            <NuxtLink
              to="/"
              class="hover:text-highlighted"
            >
              All routes
            </NuxtLink>
          </li>
          <li>Events</li>
        </ol>
      </nav>
      <h1 class="mt-3 text-balance text-[clamp(2.25rem,6vw,3.75rem)] leading-none font-bold font-display tracking-[-0.01em] text-highlighted">
        The fastest bike for every Zwift race
      </h1>
      <p class="mt-4 max-w-2xl text-lg text-toned">
        Every race day, the route it's run on, and the bike and wheel combo our physics model makes fastest for it - with the lap count and equipment rules the organisers actually set.
      </p>
    </div>

    <!-- The one race a rider is most likely here for is the next one, and it
         is otherwise several rounds down a season page. It resolves and hides
         itself (teasers off, section gated, calendars run dry). -->
    <NextRaceCard class="mt-8" />

    <!-- Reachable once every season has been run, or hidden - rare, but an
         empty page with a heading and nothing under it reads as broken
         rather than deliberate. -->
    <p
      v-if="!seriesGroups.length"
      class="mt-10 text-muted"
    >
      No races are left to run on the calendars we cover. Check back when the next season is announced.
    </p>

    <section
      v-for="series in seriesGroups"
      :key="series.seriesSlug"
      class="mt-12"
    >
      <SeriesHeading
        :series-name="series.seriesName"
        :organizer="series.organizer"
        :organizer-url="series.organizerUrl"
      />
      <div class="mt-4 space-y-4">
        <SeasonCard
          v-for="season in series.seasons"
          :key="season.slug"
          :season="season"
          :today="today"
        />
      </div>
    </section>

    <EventsDisclaimer class="mt-12" />
  </UContainer>
</template>
