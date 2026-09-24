<script setup lang="ts">
/**
 * The Discovery page for one Season's Races (see `CONTEXT.md`): the calendar
 * round by round, each race a card that leads to its ranking. It ranks
 * nothing itself and has no filters, so what it shows about a race is its
 * identity and the numbers a rider scans to choose one. It lists only what is
 * still to be run.
 */
const route = useRoute()
const seasonSlug = computed(() => route.params.season as string)

// Calendar metadata comes from the leaf module (no fetch needed); the route
// join - name, world, distance and Silhouette per race - comes from the API,
// which keeps the route surface dataset behind it on the server.
const season = getSeasonBySlug(seasonSlug.value)
if (!season) throw createError({ statusCode: 404, statusMessage: 'Season not found', fatal: true })

// `status`, `error` and `refresh` as well as the data: a failed join used to
// leave the header standing over nothing at all, with no way back short of a
// reload. `DiscoveryStatus` says so and offers the retry - the same bargain
// the homepage and the segments page strike.
const { data: seasonData, status, refresh } = await useFetch(() => `/api/events/${seasonSlug.value}`)

const rounds = computed(() => seasonData.value?.rounds ?? [])

const title = computed(() => `${season.seriesName} ${season.label}`)
const summary = computed(() => summariseSeason(season!))

// Runtime site flags: with the events section hidden, this page swaps its
// content for the unavailable notice post-mount, and /api/events/** answers
// 503 meanwhile (server/middleware/site-flags-gate.ts) - so the useFetch
// above coming back empty on a client-side visit is expected, not an error.
const { eventsVisible, eventsNotice, load: loadSiteFlags } = useSiteFlags()
onMounted(loadSiteFlags)

/**
 * The build's day while this page is prerendered, the rider's once it is on
 * their screen - see `useToday`. Everything below that asks what has been run
 * asks it of this.
 */
const today = useToday()

/**
 * The calendar still to come, and nothing else: a Race that has been run
 * leaves the page, and a Round whose Races have all been run leaves with them,
 * heading, dates and all (`roundsLeftToRun`). This page exists to get a rider
 * to a race's ranking, and a race that is over is not one they can ride.
 *
 * A round with no races yet stays: those dates are what a rider planning a
 * season has to go on, and `roundState` is written to say so.
 */
const listedRounds = computed(() => roundsLeftToRun(rounds.value, today.value))
const upcomingCount = computed(() => listedRounds.value.reduce((total, round) => total + round.races.length, 0))

/** The first race still to be run. A week-long stage that's mid-window still counts. */
const nextRaceSlug = computed(() => sortRacesByDate(listedRounds.value.flatMap(round => round.races))[0]?.slug)

/** Read off the calendar module rather than the fetch, so it holds while that is pending or has failed. */
const seasonRun = computed(() => seasonHasBeenRun(season!, today.value))

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
        // What the page lists, so a race that has been run is not in the
        // served markup under another name either.
        'itemListElement': listedRounds.value.flatMap(round => round.races.map(race => ({ round, race }))).map(({ round, race }, index) => ({
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
              v-for="race in round.races"
              :key="race.slug"
              :race="race"
              :season-slug="season!.slug"
              :next="race.slug === nextRaceSlug"
              :shape="race.silhouette"
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
      <template v-if="seasonRun">
        Every race this season has been run - the
        <NuxtLink
          to="/events"
          class="underline decoration-rule-strong hover:text-highlighted"
        >events page</NuxtLink>
        has what is still to come.
      </template>
      <template v-else>
        No races are on the calendar yet - check back once the organiser announces the schedule.
      </template>
    </p>

    <EventsDisclaimer
      class="mt-12"
      :organizer="season!.organizer"
      :organizer-url="season!.organizerUrl"
    />
  </UContainer>
</template>
