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
 * A round with no races yet stays, on its one line below: those dates are
 * what a rider planning a season has to go on, and `roundState` is written to
 * say so.
 */
const listedRounds = computed(() => roundsLeftToRun(rounds.value, today.value))
const upcomingCount = computed(() => listedRounds.value.reduce((total, round) => total + round.races.length, 0))

/**
 * The listed rounds, split: those with a race announced keep a row per race,
 * and those with nothing announced collapse to a line each under "Not
 * announced yet" (`groupRoundsByAnnouncement`). Eighteen rows of "Format to
 * come · Route to come · Details to come" said one thing eighteen times.
 */
const roundGroups = computed(() => groupRoundsByAnnouncement(listedRounds.value))
const unannouncedRaceCount = computed(() => roundGroups.value.unannounced.reduce((total, round) => total + round.races.length, 0))

/**
 * What the header says is left (`seasonStatsLeft`). Read off the calendar
 * module rather than the fetch, like `seasonRun`, so it stands while the
 * fetch is pending or has failed, and on the same day as the list below it.
 */
const stats = computed(() => seasonStatsLeft(season!.rounds, today.value))

/** The first race still to be run, which a run race's page points to as well. A week-long stage that's mid-window still counts. */
const nextRaceSlug = computed(() => nextRaceToRun(rounds.value, today.value)?.slug)

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
          { '@type': 'ListItem', 'position': 2, 'name': 'Events', 'item': `${siteConfig.url}/events` },
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
      <!-- What is left, as the list below counts it: a race that has been
           run is not listed, so it is not counted either. These are the
           page's counts, so the list prints no "N races found" of its own. -->
      <ul
        v-if="stats.length"
        class="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-md text-toned"
      >
        <li
          v-for="stat in stats"
          :key="stat.label"
        >
          <span
            v-if="stat.value !== undefined"
            class="font-semibold text-highlighted"
          >{{ stat.value }}</span>
          {{ stat.label }}
        </li>
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

    <!-- The pending skeletons and a failed fetch's retry are
         `DiscoveryStatus`, shared with the homepage and the segments page;
         the round groups it holds are this page's. Its count line is not:
         "N races found" is the voice of a filtered search, and this page has
         no filters - its counts are in the header. -->
    <DiscoveryStatus
      v-if="showsStatus"
      class="mt-10"
      subject="races"
      :counts="[{ value: upcomingCount, noun: 'race' }]"
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
        <!-- Each round is a destination: a run race whose next race has no
             page yet links to `#round-2` (`nextRaceLink`). `scroll-mt-24`
             clears the sticky header, and `tabindex="-1"` lands a keyboard
             rider here on a full load. -->
        <section
          v-for="round in roundGroups.announced"
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

          <ol>
            <RaceCard
              v-for="race in round.races"
              :key="race.slug"
              :race="race"
              :season-slug="season!.slug"
              :next="race.slug === nextRaceSlug"
              :shape="race.silhouette"
              in-round
            />
          </ol>
        </section>

        <!-- One line per round with nothing announced: its name, how many
             races and when, and whose announcement it is waiting on. Each is
             still the `#round-N` a link can land on, with the same clearance
             under the sticky header. -->
        <section
          v-if="roundGroups.unannounced.length"
          aria-labelledby="not-announced"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-accented pb-2">
            <h2
              id="not-announced"
              class="text-2xl font-semibold font-heading text-highlighted"
            >
              Not announced yet
            </h2>
            <p
              v-if="unannouncedRaceCount"
              class="text-sm text-muted"
            >
              {{ unannouncedRaceCount }} race{{ unannouncedRaceCount === 1 ? '' : 's' }}
            </p>
          </div>
          <ul>
            <li
              v-for="round in roundGroups.unannounced"
              :id="`round-${round.number}`"
              :key="round.number"
              tabindex="-1"
              class="grid scroll-mt-24 gap-x-4 gap-y-1 border-b border-default py-3.5 outline-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div>
                <p class="font-semibold text-highlighted">
                  {{ round.name ? `Round ${round.number}: ${round.name}` : `Round ${round.number}` }}
                </p>
                <p class="text-sm text-toned">
                  <template v-if="round.races.length">
                    {{ round.races.length }} race{{ round.races.length === 1 ? '' : 's' }},
                  </template>
                  {{ formatRaceDateShort(round.startDate) }} - {{ formatRaceDateShort(round.endDate) }}
                </p>
              </div>
              <p class="text-sm text-muted sm:text-right">
                Routes to come from {{ season!.organizer }}
              </p>
            </li>
          </ul>
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
