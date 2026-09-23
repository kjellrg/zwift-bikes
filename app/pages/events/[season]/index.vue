<script setup lang="ts">
import type { EventRaceWithRoute } from '../../../../shared/types/events'
import { routeSilhouette } from '#shared/utils/silhouette'

/**
 * The Discovery page for one Season's Races (see `CONTEXT.md`): the calendar
 * round by round, each race a card that leads to its ranking. It ranks
 * nothing itself and has no filters, so what it shows about a race is its
 * identity and the numbers a rider scans to choose one.
 */
const route = useRoute()
const seasonSlug = computed(() => route.params.season as string)

// Calendar metadata comes from the leaf module (no fetch needed); the route
// join - name, world, distance per race - comes from the API, which keeps the
// route surface dataset behind it on the server.
const season = getSeasonBySlug(seasonSlug.value)
if (!season) throw createError({ statusCode: 404, statusMessage: 'Season not found', fatal: true })

// `status`, `error` and `refresh` as well as the data: a failed join used to
// leave the header standing over nothing at all, with no way back short of a
// reload. `DiscoveryStatus` says so and offers the retry - the same bargain
// the homepage and the segments page strike.
const { data: seasonData, status, refresh } = await useFetch(() => `/api/events/${seasonSlug.value}`)

const rounds = computed(() => seasonData.value?.rounds ?? [])

/**
 * Each race row's Silhouette, by route. The catalog listing is the only
 * endpoint that carries a route's shape, and it carries every route's; the
 * transform runs where the fetch does and keeps only this season's primary
 * routes, resampled to a row's width, so that is all the payload holds.
 */
const primarySlugs = new Set(getVisibleSeasonRaces(season).map(primaryRouteSlug).filter((slug): slug is string => Boolean(slug)))
const { data: silhouettes } = await useFetch('/api/routes', {
  key: `season-silhouettes-${season.slug}`,
  query: { sport: 'cycling' },
  transform: response => Object.fromEntries(response.routes
    .filter(entry => primarySlugs.has(entry.slug))
    .map(entry => [entry.slug, routeSilhouette(entry, 1, { samples: 40 })]))
})
const shapeFor = (race: EventRaceWithRoute) => {
  const slug = primaryRouteSlug(race)
  return slug ? silhouettes.value?.[slug] : undefined
}
const title = computed(() => `${season.seriesName} ${season.label}`)
const summary = computed(() => summariseSeason(season!))

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
/** The rounds that have been run - see `roundState`, which the hub's tiles ask too. */
const runRoundNumbers = ref(new Set<number>())
onMounted(() => {
  loadSiteFlags()
  const today = new Date().toISOString().slice(0, 10)
  const visible = sortRacesByDate(getVisibleSeasonRaces(season))
  // A week-long stage that's mid-window still counts as the next race.
  nextRaceSlug.value = visible.find(race => raceEndDate(race) >= today)?.slug
  pastRaceSlugs.value = new Set(visible.filter(race => raceEndDate(race) < today).map(race => race.slug))
  runRoundNumbers.value = new Set(season!.rounds.filter(round => roundState(round, today) === 'past').map(round => round.number))
})

/**
 * The calendar still to come. A round that has been run leaves it entirely -
 * heading, dates and all - rather than standing there saying its races have
 * been run, which put the least useful thing on the page at the top of it.
 * Its races are under their round in "Past races" below.
 *
 * A round with no races yet stays: those dates are what a rider planning a
 * season has to go on, and `roundState` is written to say so.
 */
const listedRounds = computed(() => rounds.value.filter(round => !runRoundNumbers.value.has(round.number)))

const upcomingRacesForRound = (round: { races: EventRaceWithRoute[] }) => round.races.filter(race => !pastRaceSlugs.value.has(race.slug))
const upcomingCount = computed(() => rounds.value.reduce((total, round) => total + upcomingRacesForRound(round).length, 0))

/** Past races keep their round headings in the collapsible - a race is not less findable for having been run. */
const pastRounds = computed(() => rounds.value
  .map(round => ({ ...round, races: round.races.filter(race => pastRaceSlugs.value.has(race.slug)) }))
  .filter(round => round.races.length))
const pastRaceCount = computed(() => pastRounds.value.reduce((total, round) => total + round.races.length, 0))

/**
 * The status block belongs to the fetch: still loading, failed, or a calendar
 * with races still to come. A season whose races have all been run is not an
 * empty search result - "0 races found" and "No races match your filters" are
 * the homepage's voice for a filter that matched nothing, and this page has
 * no filters at all. It says what has actually happened, in its own words,
 * below.
 */
const showsStatus = computed(() => status.value === 'pending' || status.value === 'error' || upcomingCount.value > 0)

const siteConfig = useSiteConfig()
const seasonUrl = computed(() => `${siteConfig.url}/events/${season!.slug}`)

useSeoMeta({
  title: () => `${title.value} schedule: the fastest bike for every race | ZwiftBikes`,
  description: () => `Every ${title.value} race date and route, with the fastest bike and wheel combo for each one - lap counts and TT bike rules included.`,
  ogTitle: () => `${title.value} schedule`,
  ogDescription: () => season!.description
})

defineOgImage('SiteCard', {}, { alt: 'ZwiftBikes - the fastest bike and wheelset for every race on the calendar' })

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
        'itemListElement': rounds.value.flatMap(round => round.races.map(race => ({ round, race }))).map(({ round, race }, index) => ({
          '@type': 'ListItem',
          'position': index + 1,
          'name': `${round.name ? `${round.name} ` : ''}${raceDisplayName(race)}${race.categories[0]?.route ? ` - ${race.categories[0].route.name}` : ''}`,
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
    class="pb-8"
  >
    <div class="pt-8 sm:pt-12">
      <nav aria-label="Breadcrumb">
        <ol class="flex flex-wrap gap-x-3.5 text-sm text-muted">
          <li>
            <NuxtLink
              to="/events"
              class="hover:text-highlighted"
            >
              Events
            </NuxtLink>
          </li>
          <li>{{ season!.seriesName }}</li>
        </ol>
      </nav>
      <h1 class="mt-3 text-balance text-[clamp(2.25rem,6vw,3.75rem)] leading-none font-bold font-display tracking-[-0.01em] text-highlighted">
        {{ title }} schedule
      </h1>
      <p class="mt-4 max-w-3xl text-lg text-toned">
        {{ season!.description }}
      </p>
      <!-- The whole season, not the part still to come: these say how big
           the calendar is, and a race being run does not shrink it. -->
      <ul class="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-md text-toned">
        <li><span class="font-semibold text-highlighted">{{ summary.rounds }}</span> round{{ summary.rounds === 1 ? '' : 's' }}</li>
        <li><span class="font-semibold text-highlighted">{{ summary.races }}</span> race{{ summary.races === 1 ? '' : 's' }}</li>
        <li>{{ formatSeasonSpan(summary) ?? 'Dates to come' }}</li>
      </ul>
      <p class="mt-3 text-sm text-muted">
        Organised by
        <a
          v-if="season!.organizerUrl"
          :href="season!.organizerUrl"
          target="_blank"
          rel="noopener"
          class="underline decoration-rule-strong hover:text-highlighted"
        >{{ season!.organizer }}</a>
        <template v-else>
          {{ season!.organizer }}
        </template>. Race dates and routes are theirs; the bike and wheel recommendations are ours.
      </p>
      <SiteNotice
        v-if="season!.note"
        class="mt-5"
        title="Season status"
      >
        <p>{{ season!.note }}</p>
      </SiteNotice>
    </div>

    <!-- The count line, the pending skeletons and a failed fetch's retry are
         `DiscoveryStatus`, shared with the homepage and the segments page;
         the round groups it holds are this page's. -->
    <DiscoveryStatus
      v-if="showsStatus"
      class="mt-10"
      subject="races"
      :counts="[{ value: upcomingCount, noun: 'race' }]"
      :status="status"
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
        <!-- Each round is a destination: the hub's season cards link to
             `#round-2`. `scroll-mt-24` clears the sticky header, and
             `tabindex="-1"` lands a keyboard rider here on a full load. -->
        <section
          v-for="round in listedRounds"
          :id="`round-${round.number}`"
          :key="round.number"
          tabindex="-1"
          class="scroll-mt-24 outline-none"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-accented pb-2">
            <h2 class="text-2xl font-semibold font-heading text-highlighted">
              {{ round.name ? `Round ${round.number}: ${round.name}` : `Round ${round.number}` }}
            </h2>
            <p class="text-sm text-muted">
              {{ formatRaceDateShort(round.startDate) }} - {{ formatRaceDateShort(round.endDate) }}
            </p>
          </div>

          <!-- Listed for its dates - see `roundState` - so it says why it is
               empty rather than leaving a heading over nothing. -->
          <p
            v-if="!round.races.length"
            class="py-4 text-sm text-muted"
          >
            The organiser hasn't published this round's schedule yet.
          </p>
          <ol v-else>
            <RaceCard
              v-for="race in upcomingRacesForRound(round)"
              :key="race.slug"
              :race="race"
              :season-slug="season!.slug"
              :next="race.slug === nextRaceSlug"
              :shape="shapeFor(race)"
            />
          </ol>
        </section>
      </div>
    </DiscoveryStatus>

    <!-- Not "0 races found": see `showsStatus`. A finished season and a
         season that hasn't been published yet are different answers. -->
    <p
      v-else
      class="mt-10 py-6 text-muted"
    >
      <template v-if="pastRaceCount">
        Every race this season has been run - check back when the next season is announced.
      </template>
      <template v-else>
        No races are on the calendar yet - check back once the organiser announces the schedule.
      </template>
    </p>

    <!-- Open when nothing is upcoming: on a finished season this disclosure
         holds the entire page. -->
    <UCollapsible
      v-if="pastRaceCount"
      class="mt-10"
      :default-open="!upcomingCount"
    >
      <UButton
        color="neutral"
        variant="outline"
        trailing-icon="i-lucide-chevron-down"
      >
        Past races ({{ pastRaceCount }})
      </UButton>
      <template #content>
        <div class="mt-6 space-y-8">
          <section
            v-for="round in pastRounds"
            :key="round.number"
          >
            <h3 class="border-b border-accented pb-2 text-lg font-semibold font-heading text-highlighted">
              {{ round.name ? `Round ${round.number}: ${round.name}` : `Round ${round.number}` }}
            </h3>
            <ol>
              <RaceCard
                v-for="race in round.races"
                :key="race.slug"
                :race="race"
                :season-slug="season!.slug"
                :shape="shapeFor(race)"
                past
              />
            </ol>
          </section>
        </div>
      </template>
    </UCollapsible>

    <EventsDisclaimer
      class="mt-12"
      :organizer="season!.organizer"
      :organizer-url="season!.organizerUrl"
    />
  </UContainer>
</template>
