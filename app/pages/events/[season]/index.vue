<script setup lang="ts">
import type { EventRaceWithRoute } from '../../../../shared/types/events'

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
  title: () => `${title.value} Schedule - Routes & Best Bikes - ZwiftBikes`,
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
    class="py-10 space-y-10"
  >
    <div class="space-y-6">
      <div class="flex flex-wrap items-center gap-3 text-sm text-muted">
        <UButton
          to="/events"
          variant="link"
          color="neutral"
          icon="i-lucide-arrow-left"
          class="px-0"
        >
          All race calendars
        </UButton>
      </div>
      <!-- The race page's header, one level up: eyebrow, heading, what it is,
           whose calendar it is - then the numbers on the right. A rider
           arriving from a race page should read the same page continuing. -->
      <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
            {{ season!.seriesName }}
          </p>
          <h1 class="mt-1 text-3xl font-bold text-highlighted break-words sm:text-4xl">
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
        <!-- The whole season, not the part still to come: these say how big
             the calendar is, and a race being run does not shrink it. -->
        <dl class="grid shrink-0 grid-cols-3 gap-4 sm:gap-8">
          <div>
            <dt class="text-xs text-muted">
              Rounds
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ summary.rounds }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Races
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ summary.races }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Dates
            </dt><dd class="text-base font-bold text-highlighted sm:text-lg">
              {{ formatSeasonSpan(summary) ?? 'To come' }}
            </dd>
          </div>
        </dl>
      </div>

      <UAlert
        v-if="season!.note"
        color="primary"
        variant="subtle"
        icon="i-lucide-calendar-clock"
        title="Season status"
        :description="season!.note"
      />
    </div>

    <!-- The count line, the pending skeletons and a failed fetch's retry are
         `DiscoveryStatus`, shared with the homepage and the segments page;
         the round groups it holds are this page's, the way the segments page
         fills it with world groups. -->
    <DiscoveryStatus
      v-if="showsStatus"
      subject="races"
      :counts="[{ value: upcomingCount, noun: 'race' }]"
      :status="status"
      @retry="refresh"
    >
      <template #skeleton>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <RaceCardSkeleton
            v-for="n in 6"
            :key="n"
          />
        </div>
      </template>

      <!-- One child of the slot, so the rounds keep the page's own rhythm
           apart from each other rather than the status block's tighter one. -->
      <div class="space-y-10">
        <!-- Each round is a destination: the hub's season cards link to
             `#round-2`. `scroll-mt-24` clears the sticky header, which a bare
             hash jump would otherwise leave the heading under, and
             `tabindex="-1"` means a full page load on that link lands a
             keyboard rider here too, not just the scrollbar. -->
        <section
          v-for="round in listedRounds"
          :id="`round-${round.number}`"
          :key="round.number"
          tabindex="-1"
          class="space-y-4 scroll-mt-24 outline-none"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-xl font-semibold text-highlighted">
              {{ round.name ? `Round ${round.number}: ${round.name}` : `Round ${round.number}` }}
            </h2>
            <p class="text-sm text-muted">
              {{ formatRaceDateShort(round.startDate) }} - {{ formatRaceDateShort(round.endDate) }}
            </p>
          </div>

          <!-- The round a rider is here to plan around, whose schedule the
               organiser hasn't published yet. It is listed for its dates -
               see `roundState` - so it says why it is empty rather than
               leaving a heading over nothing. -->
          <p
            v-if="!round.races.length"
            class="text-sm text-muted"
          >
            The organiser hasn't published this round's schedule yet.
          </p>
          <div
            v-else
            class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            <RaceCard
              v-for="race in upcomingRacesForRound(round)"
              :key="race.slug"
              :race="race"
              :season-slug="season!.slug"
              :next="race.slug === nextRaceSlug"
            />
          </div>
        </section>
      </div>
    </DiscoveryStatus>

    <!-- Not "0 races found": see `showsStatus`. A finished season and a
         season that hasn't been published yet are different answers, and
         both of them are answers rather than an empty result. -->
    <p
      v-else
      class="text-center py-10 text-muted"
    >
      <template v-if="pastRaceCount">
        Every race this season has been run - check back when the next season is announced.
      </template>
      <template v-else>
        No races are on the calendar yet - check back once the organiser announces the schedule.
      </template>
    </p>

    <!-- Open when nothing is upcoming: on a finished season this disclosure
         holds the entire page, and hiding it behind a click is the same
         defect as burying the rounds was. -->
    <UCollapsible
      v-if="pastRaceCount"
      :default-open="!upcomingCount"
    >
      <UButton
        color="neutral"
        variant="subtle"
        trailing-icon="i-lucide-chevron-down"
      >
        Past races ({{ pastRaceCount }})
      </UButton>
      <template #content>
        <div class="mt-4 space-y-10">
          <div
            v-for="round in pastRounds"
            :key="round.number"
            class="space-y-4"
          >
            <h3 class="text-lg font-semibold text-highlighted">
              {{ round.name ? `Round ${round.number}: ${round.name}` : `Round ${round.number}` }}
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <RaceCard
                v-for="race in round.races"
                :key="race.slug"
                :race="race"
                :season-slug="season!.slug"
                past
              />
            </div>
          </div>
        </div>
      </template>
    </UCollapsible>

    <EventsDisclaimer
      :organizer="season!.organizer"
      :organizer-url="season!.organizerUrl"
    />
  </UContainer>
</template>
