<script setup lang="ts">
import type { EventSeasonWithRoutes } from '../../../shared/types/events'

/**
 * The events hub, a Discovery page for Races (see `CONTEXT.md`): every race
 * still to run that we can rank, across every Season, as one list by date -
 * on now, in the next seven days, later - each row tagged with its series.
 * Under it one box per Season still running says where it stands and what
 * the organiser has yet to announce. It ranks nothing and has no filters.
 *
 * It used to list Seasons, and a rider went from a season card to a round
 * tile to a season page before seeing a race. The list is the races
 * themselves now, so the season cards, their round tiles and the "Next race"
 * strip are gone; the "On now" group is what the strip was.
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
 * their screen - see `useToday`. The groups, their counts and the series
 * boxes all ask it, so the served HTML is the build's day throughout, and
 * hydration draws what was served.
 */
const today = useToday()

/**
 * The seasons still running on the day the page renders, each fetched joined
 * to its routes: a row draws its course's world, this site's own distance
 * and climbing where the organiser published none, and its Silhouette, none
 * of which the calendar module holds (see its leaf rule). The season
 * endpoint is the one a season page reads, and a season is a few KB of
 * payload. Fixed at render: the rider's clock only ever takes races away.
 */
const fetchedSlugs = seasons.filter(season => !seasonHasBeenRun(season, today.value)).map(season => season.slug)
const { data: calendars, status, refresh } = await useAsyncData(
  'events-hub-calendars',
  () => Promise.all(fetchedSlugs.map(slug => $fetch<EventSeasonWithRoutes>(`/api/events/${slug}`)))
)

/** The races, grouped by when they are run (`hubRaceGroups`): only those with a page, and nothing that has been run. */
const groups = computed(() => hubRaceGroups(calendars.value ?? [], today.value))
const listedCount = computed(() => groups.value.reduce((total, group) => total + group.races.length, 0))

/**
 * "In 5 days" is true on one day only, so it is not in the served HTML, which
 * is the build's: each row's relative line is drawn once the page is on the
 * rider's screen, from their clock.
 */
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})

/**
 * One box per Season still running, newest first, read off the calendar
 * module rather than the fetch, so the boxes stand while it is pending or
 * has failed. A season whose every race has been run has no box, and once
 * none is left the page says so in a sentence.
 */
const runningSeasons = computed(() => sortSeasonsNewestFirst(seasons.filter(season => !seasonHasBeenRun(season, today.value))))

/**
 * The list's status belongs to the fetch: still loading, failed, or races to
 * show. With the fetch in and nothing to list, the page says why in its own
 * words instead of "No races match your filters" - it has no filters.
 */
const showsStatus = computed(() => status.value === 'pending' || status.value === 'error' || listedCount.value > 0)

const copy = hubCopy(seasons)
const siteConfig = useSiteConfig()

useSeoMeta({
  title: `${copy.headline} | ZwiftBikes`,
  description: copy.description,
  ogTitle: copy.ogTitle,
  ogDescription: copy.description
})

defineOgImage('SiteCard', {}, { alt: copy.ogAlt })

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
    <!-- No breadcrumb: Events is a top-level item in the site's nav. -->
    <div class="pt-8 sm:pt-12">
      <h1 class="text-balance text-[clamp(2.25rem,6vw,3.75rem)] leading-none font-bold font-display tracking-[-0.01em] text-highlighted">
        {{ copy.headline }}
      </h1>
      <p class="mt-4 max-w-2xl text-lg text-toned">
        {{ copy.lede }}
      </p>
    </div>

    <!-- The skeleton and a failed fetch's retry are `DiscoveryStatus`, as on
         a season page; the groups' headings carry the counts. -->
    <DiscoveryStatus
      v-if="showsStatus"
      class="mt-10"
      subject="races"
      :counts="[{ value: listedCount, noun: 'race' }]"
      :status="status"
      count-elsewhere
      @retry="refresh"
    >
      <template #skeleton>
        <ul>
          <RaceCardSkeleton
            v-for="n in 5"
            :key="n"
          />
        </ul>
      </template>

      <div class="space-y-10">
        <section
          v-for="group in groups"
          :key="group.when"
          :aria-labelledby="group.when"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-accented pb-2">
            <h2
              :id="group.when"
              class="text-2xl font-semibold font-heading text-highlighted"
            >
              {{ group.title }}
            </h2>
            <p class="text-sm text-muted">
              {{ group.races.length }} race{{ group.races.length === 1 ? '' : 's' }}
            </p>
          </div>
          <ol>
            <RaceCard
              v-for="entry in group.races"
              :key="`${entry.seasonSlug}/${entry.race.slug}`"
              :race="entry.race"
              :season-slug="entry.seasonSlug"
              :shape="entry.race.silhouette"
              :tag="entry.tag"
              :when="mounted ? relativeRaceDay(entry.race, today) : undefined"
            />
          </ol>
        </section>
      </div>
    </DiscoveryStatus>

    <!-- Reachable between announcements, or once every season has been run -
         rare, but a page with nothing under its headline reads as broken
         rather than deliberate. -->
    <p
      v-else
      class="mt-10 text-muted"
    >
      <template v-if="runningSeasons.length">
        None of the races announced so far is one we can rank - the series below say what is coming.
      </template>
      <template v-else>
        No races are left to run on the calendars we cover. Check back when the next season is announced.
      </template>
    </p>

    <!-- Where each series stands, and what its organiser has yet to
         announce: the races the list above cannot hold. The organiser link
         keeps its place here, since we complement their pages. -->
    <section
      v-if="runningSeasons.length"
      aria-labelledby="the-series"
      class="mt-12"
    >
      <h2
        id="the-series"
        class="border-b border-accented pb-2 text-2xl font-semibold font-heading text-highlighted"
      >
        The series
      </h2>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <article
          v-for="season in runningSeasons"
          :key="season.slug"
          class="flex flex-col items-start gap-3 rounded-xl border border-default bg-elevated p-5"
        >
          <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h3 class="text-xl font-semibold font-heading">
              <NuxtLink
                :to="`/events/${season.slug}`"
                class="text-highlighted underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
              >
                {{ season.seriesName }} {{ season.label }}
              </NuxtLink>
            </h3>
            <span class="text-sm text-muted">
              by
              <a
                v-if="season.organizerUrl"
                :href="season.organizerUrl"
                target="_blank"
                rel="noopener"
                class="underline decoration-rule-strong hover:text-highlighted"
              >{{ season.organizer }}</a>
              <template v-else>{{ season.organizer }}</template>
            </span>
          </div>
          <ul class="space-y-1.5 text-toned">
            <li
              v-for="line in seriesStatusLines(season, today)"
              :key="line"
            >
              {{ line }}
            </li>
          </ul>
          <NuxtLink
            :to="`/events/${season.slug}`"
            class="font-medium text-primary hover:underline"
          >
            Full {{ season.seriesTag }} schedule
          </NuxtLink>
        </article>
      </div>
    </section>

    <EventsDisclaimer class="mt-12" />
  </UContainer>
</template>
