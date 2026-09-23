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
/**
 * Today, once the page is on a rider's screen. Handed to the season cards so
 * a round tile knows whether the round it points at is still on the season
 * page - the cards must not ask the clock themselves, for the same reason
 * this page resolves it here: it is prerendered, and a build-time answer
 * would ship frozen.
 */
const today = ref<string>()
onMounted(() => {
  loadSiteFlags()
  today.value = new Date().toISOString().slice(0, 10)
  pastSeasonSlugs.value = new Set(seasons
    .filter(season => getVisibleSeasonRaces(season).every(race => raceEndDate(race) < today.value!))
    .map(season => season.slug))
})
const isPastSeason = (season: EventSeason) => pastSeasonSlugs.value.has(season.slug)
/**
 * A series is listed while any of its seasons is still running. One whose
 * every season has finished goes, seasons and all, into the collapsible
 * below - a heading with nothing under it reads as broken, the same rule the
 * segments page applies to a world its filters empty.
 */
const activeSeriesGroups = computed(() => seriesGroups.value.filter(group => group.seasons.some(season => !isPastSeason(season))))
/**
 * Finished seasons keep their series grouping inside the disclosure, rather
 * than becoming a flat list: the organiser badge hangs off the series
 * heading, and a series whose every season has finished is listed nowhere
 * else - so flattening this would take the only link to that organiser off
 * the page with it.
 */
const pastSeriesGroups = computed(() => seriesGroups.value
  .map(group => ({ ...group, seasons: sortSeasonsNewestFirst(group.seasons.filter(isPastSeason)) }))
  .filter(group => group.seasons.length))
const pastSeasonCount = computed(() => pastSeriesGroups.value.reduce((total, group) => total + group.seasons.length, 0))

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

    <!-- Reachable by hiding every season - rare, but an empty page with a
         heading and nothing under it reads as broken rather than deliberate. -->
    <p
      v-if="!seasons.length"
      class="mt-10 text-muted"
    >
      No race calendars are being tracked at the moment. Check back when the next season is announced.
    </p>

    <section
      v-for="series in activeSeriesGroups"
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
          v-for="season in series.seasons.filter(s => !isPastSeason(s))"
          :key="season.slug"
          :season="season"
          :today="today"
        />
      </div>
    </section>

    <UCollapsible
      v-if="pastSeasonCount"
      class="mt-12"
    >
      <UButton
        color="neutral"
        variant="outline"
        trailing-icon="i-lucide-chevron-down"
      >
        Past seasons ({{ pastSeasonCount }})
      </UButton>
      <template #content>
        <div class="mt-6 space-y-10">
          <section
            v-for="series in pastSeriesGroups"
            :key="series.seriesSlug"
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
        </div>
      </template>
    </UCollapsible>

    <EventsDisclaimer class="mt-12" />
  </UContainer>
</template>
