<script setup lang="ts">
import { raceRide, raceStatement } from '../../../../shared/utils/rideStatement'

/**
 * One race. Everything a route page can't know - the date, the lap count for
 * the rider's Category group, the equipment rules, where the points are -
 * is the race's Ride statement (`raceStatement`), and the ranking goes
 * through `useRankingPage`, the same module the route and segment pages hand
 * a Ride to, so they can't drift in behaviour. This page's script is its
 * selection, the draft nudge's dismissal and the wiring.
 */
const route = useRoute()
const seasonSlug = computed(() => route.params.season as string)
const raceSlug = computed(() => route.params.race as string)

const season = getSeasonBySlug(seasonSlug.value)
const found = season ? getRaceBySlug(seasonSlug.value, raceSlug.value) : undefined
if (!season || !found || !isRacePublishable(found)) {
  throw createError({ statusCode: 404, statusMessage: 'Race not found', fatal: true })
}
// A race with a page has a format: the equipment rules are derived from it.
const race = found

// A/B and C/D routinely race the same route over a different number of laps,
// which changes the distance, the climbing and therefore the ranking - so the
// group is the page's primary control, not a footnote. A Category group (see
// `CONTEXT.md`) is the race's, never the rider's: the laps come with it.
const categoryGroupIndex = ref(0)
const categoryGroupOptions = race.categories.map((group, index) => ({
  label: `${formatCategoryGroup(group)} – ${group.laps} lap${group.laps === 1 ? '' : 's'}`,
  value: index
}))

/**
 * The Ride: this group's course and lap count, plus the two equipment rules
 * a race has and a route page doesn't - see `raceRide`.
 *
 * `useRecommendRequest` makes the rider's stored settings race-legal from
 * them - a rider whose stored category is `tt` is ranked across all legal
 * categories where TT frames are outlawed (matching the "All categories" the
 * hidden-TT select shows them), and a race WTRL turns drafting off in is
 * ranked solo, because a ranking computed at bunch speeds there would be
 * minutes fast and could genuinely reorder the list. Neither stored
 * preference is touched: both still apply to every other race they open.
 *
 * A group with no catalog route is no Ride at all, so nothing is requested
 * and nothing is ranked - the page still shows that group's published figures.
 */
const ride = computed(() => raceRide(race, categoryGroupIndex.value))
// The SELECTED group's course, which follows the selector the moment it
// moves and is absent for a group with no catalog route; the course the
// ranking on screen was computed over is the Applied Ranking's, looked up by
// the request under the same key once it has landed - see `useCourse`.
// Declared before the ranking page module, whose statement is built from it.
const { ready: courseReady, course: routeInfo } = useCourse(() => ride.value?.course)

/**
 * Whether this Race has been run is decided on the day the page is rendered
 * on and then on the rider's own clock - see `useToday`. A run race keeps its
 * page, so a link a rider shared still lands, but the page says so above its
 * title, in the words its markdown twin uses too (`runRaceNotice`), and
 * points to the season's next race and to the route.
 */
const today = useToday()

const siteConfig = useSiteConfig()
// Everything this page shows about its Ranking - see `useRankingPage` - and
// everything it says about its Ride on its own, in its Ride statement. The
// module reads the Applied Ranking's course and the Applied laps throughout,
// so on this page - the one whose Ride's own identity moves - nothing
// explains the times on screen with the group the selector has just moved
// to.
const rankingPage = useRankingPage({
  ride: () => ride.value,
  key: `recommend-race-${seasonSlug.value}-${raceSlug.value}`,
  // A race's description names no setup, so the statement takes no answer.
  statement: () => raceStatement({ season, race, groupIndex: categoryGroupIndex.value, course: routeInfo.value, today: today.value, siteUrl: siteConfig.url })
})
const { tttPlan, rules, bikeSearch, bikeSearchDebounced } = rankingPage
// A race always has a statement: it is the race's own, with or without a course.
const statement = computed(() => rankingPage.statement.value!)
// The results announcement, which a group with no catalog route renders
// above its own notice, where the body would have it.
const { resultsAnnouncement } = rankingPage.request
// Fired together: the recommendation doesn't depend on the lookup resolving first.
await Promise.all([courseReady, rankingPage.ready])

// `?group=1&bike=tarmac&category=tt&draft=ttt` - see `useSharedView`. The
// group is the one knob a race link carries beyond the Ride's identity: it
// changes the course and the lap count, and it is an index, so the first
// group is the value a clean link omits. Laps are deliberately NOT carried -
// they come with the group, from the organiser, and are never the rider's to
// pick here.
useSharedView(
  { bikeSearch, bikeSearchDebounced },
  { key: 'group', value: categoryGroupIndex, min: 0, max: () => categoryGroupOptions.length - 1 }
)

// Runtime site flags: with the events section hidden, this page swaps its
// content for the unavailable notice post-mount - the prerendered HTML
// always carries the content (server/middleware/site-flags-gate.ts gates
// the section's data endpoints meanwhile).
const { eventsVisible, eventsNotice, load: loadSiteFlags } = useSiteFlags()
onMounted(() => loadSiteFlags())

/** The draft nudge, until the rider dismisses it for the visit. */
const draftNudgeDismissed = ref(false)

useSeoMeta({
  title: () => statement.value.title,
  description: () => statement.value.description,
  ogTitle: () => statement.value.ogTitle,
  ogDescription: () => statement.value.ogDescription
})

if (statement.value.hasRun) {
  // Decided on the server's day, so the rule is in the served HTML and the
  // X-Robots-Tag header, which is where a crawler reads it: the module owns
  // the one robots tag and does not change it after load. A race
  // run on the server's day is off the prerender list (`getIndexedRaces`), so
  // its page is rendered by the server on the real day. A race run since the
  // last build is still served prerendered and indexable until the next one,
  // and its notice appears after load from the rider's clock meanwhile. Its
  // links are still followed: they are where a rider should go next.
  useRobotsRule('noindex, follow')
}

// Issue #59: a generated card replaces the old hotlinked world minimap.
// Snapshotted once at setup - the build-time prerender pass (zeroRuntime
// never re-renders) - so the combo is the DEFAULT rider profile's, matching
// what the prerendered page shows: the first Category group's rank 1, and
// its course as its Silhouette, for its lap count with the lead-in once. See
// `RankingPageShareCard`. A run race has no card of its own (its page is not
// prerendered, so the image would never be built) and shares the site's
// (`app.vue`); its title and description are still the race's.
const shareCard = statement.value.shareCard
if (shareCard) {
  const { frameName, wheelName, silhouette } = rankingPage.shareCard.value
  defineOgImage('EventCard', {
    ...shareCard.props,
    frameName: shareCard.namesSetup ? frameName : undefined,
    wheelName: shareCard.namesSetup ? wheelName : undefined,
    profile: silhouette
  }, { alt: shareCard.alt })
}
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
    <!-- Above the title, so a rider who followed an old link reads it before
         anything else. Served in the HTML when the race was run before the
         page was rendered, and drawn after load when it has been run since. -->
    <section
      v-if="statement.runNotice"
      aria-label="This race has been run"
      class="mt-5 sm:mt-8"
    >
      <SiteNotice :title="statement.runNotice.title">
        <p>
          {{ statement.runNotice.ranOn }}
        </p>
        <p>
          {{ statement.runNotice.next.lead }}
          <NuxtLink
            :to="statement.runNotice.next.to"
            class="font-medium text-highlighted underline decoration-rule-strong"
          >{{ statement.runNotice.next.label }}</NuxtLink>
        </p>
        <p v-if="statement.runNotice.route">
          {{ statement.runNotice.route.lead }}
          <NuxtLink
            :to="statement.runNotice.route.to"
            class="font-medium text-highlighted underline decoration-rule-strong"
          >{{ statement.runNotice.route.label }}</NuxtLink>
        </p>
      </SiteNotice>
    </section>
    <RideHeading
      :crumbs="statement.heading.crumbs"
      :name="statement.heading.name"
    >
      <!-- The Category group is the race's one selection, in the header so
           choosing a group redraws the Fact row and the course before the
           answer is read. Laps are not offered: they come with the group. -->
      <div
        v-if="categoryGroupOptions.length > 1"
        class="mt-4 flex flex-wrap items-center gap-3"
      >
        <label
          for="race-group"
          class="text-sm text-muted"
        >Your race group</label>
        <USelectMenu
          id="race-group"
          v-model="categoryGroupIndex"
          value-key="value"
          :items="categoryGroupOptions"
          :search-input="false"
          size="sm"
          class="w-60 max-w-full"
          aria-label="Your race group"
        />
      </div>
    </RideHeading>

    <RideFactRow
      :facts="statement.facts"
      :surface="statement.surface"
    >
      <li v-if="statement.coverageNote">
        {{ statement.coverageNote }}
      </li>
      <li>{{ statement.rules.alert }}</li>
      <!-- A rule, not a nudge: the ranking is computed solo whatever the
           rider's saved draft mode says, so this states what happened. -->
      <li v-if="statement.rules.soloNote">
        {{ statement.rules.soloNote }}
      </li>
      <li v-if="statement.officialFiguresNote">
        {{ statement.officialFiguresNote }}
      </li>
      <TttFactLine
        v-if="tttPlan"
        :plan="tttPlan"
      />
    </RideFactRow>

    <CourseHero
      v-if="routeInfo && ride"
      :route="routeInfo"
      :laps="ride.laps ?? 1"
      :name="statement.routeName"
      :scoring-slugs="statement.scoring.starredSlugs"
    />

    <template v-if="!ride">
      <RecommendDataNotice class="mt-6" />
      <p
        class="sr-only"
        role="status"
        aria-live="polite"
      >
        {{ resultsAnnouncement }}
      </p>
      <SiteNotice
        class="mt-8"
        :title="`${statement.routeName} isn't in the public route catalog`"
      >
        <p>
          {{ season.organizer }} runs {{ statement.groupLabel }} on an event-exclusive route we have no data for, so there is no distance, elevation or surface to simulate against – and a ranking computed from a guess would be worse than none. The published figures above are {{ season.organizer }}'s own.<template v-if="categoryGroupOptions.length > 1">
            Pick another race group above to see recommendations for the routes we do have.
          </template>
        </p>
      </SiteNotice>
      <!-- Everything the organiser published that needs no catalog route. -->
      <section
        v-if="statement.scoring.shown"
        class="mt-10"
        aria-labelledby="race-scoring-heading"
      >
        <h2
          id="race-scoring-heading"
          class="mb-3 text-2xl font-semibold font-heading text-highlighted"
        >
          Where the points are
        </h2>
        <RaceScoringSegments
          :rows="statement.scoring.rows"
          :tbd="statement.scoring.tbd"
          :organizer="season.organizer"
          :group-label="statement.groupLabel"
          :rules="statement.rules"
        />
      </section>
    </template>

    <template v-else>
      <RankingPageBody :page="rankingPage">
        <template #page-block>
          <RaceFormatDraftNudge
            v-if="rules?.draftNudge && !draftNudgeDismissed"
            :nudge="rules.draftNudge"
            @dismiss="draftNudgeDismissed = true"
          />
        </template>

        <template #rider="card">
          <RiderCard
            :rider="card.rider"
            :refreshing="card.refreshing"
            :has-long-climb="card.hasLongClimb"
            :draft-locked="card.draftLocked"
            :tt-barred="card.ttBarred"
            :fixed-laps="statement.fixedLaps"
            :applied-laps="card.appliedLaps"
          />
        </template>

        <template #report-link="{ reportLine }">
          <ReportDataLink
            :item="statement.reportItem"
            :ride="reportLine"
          />
        </template>

        <!-- Only when there is something to score: a scratch race scores
             nothing along the way, and the tab exists exactly when this does. -->
        <template
          v-if="statement.scoring.shown"
          #scoring
        >
          <RaceScoringSegments
            :rows="statement.scoring.rows"
            :tbd="statement.scoring.tbd"
            :organizer="season.organizer"
            :group-label="statement.groupLabel"
            :rules="statement.rules"
          />
        </template>
      </RankingPageBody>

      <p
        v-if="routeInfo"
        class="mt-8 text-sm text-muted"
      >
        Racing a different number of laps, or riding this route outside the event?
        <NuxtLink
          :to="`/routes/${routeInfo.slug}`"
          class="text-toned underline decoration-rule-strong hover:text-highlighted"
        >Fastest bike for {{ routeInfo.name }}</NuxtLink>.
        <!-- The route page knows nothing of this race, so it ranks the TT
             frames this race bars. Better said than silently contradicted. -->
        <template v-if="statement.rules.ttFramesBarred">
          It ranks every bike in the game, TT frames included – this race's rule is the race's, not the route's.
        </template>
      </p>
    </template>

    <!-- The organiser's own context - the PowerUps, how the race plays
         out, where its rules live - after the answer rather than in the
         Fact row, which shares a phone's first screen with the time. -->
    <section
      v-if="race.note || statement.powerupsLine || statement.coursesDiffer || race.sourceUrl || season.organizerUrl"
      class="mt-16"
      aria-labelledby="race-note-heading"
    >
      <h2
        id="race-note-heading"
        class="text-2xl font-semibold font-heading text-highlighted"
      >
        {{ race.note ? 'How this race tends to play out' : 'About this race' }}
      </h2>
      <p
        v-if="race.note"
        class="mt-3 max-w-[72ch] text-toned"
      >
        {{ race.note }}
      </p>
      <!-- Curated fact only: absent powerup data renders no line at all. -->
      <p
        v-if="statement.powerupsLine"
        class="mt-3 text-toned"
      >
        {{ statement.powerupsLine }}
      </p>
      <!-- Each Category group's course, readable at a glance without moving the selector. -->
      <div
        v-if="statement.coursesDiffer"
        class="mt-4 overflow-x-auto"
      >
        <table class="w-full border-collapse text-sm">
          <caption class="sr-only">
            Course, laps and published figures for each category group in this race
          </caption>
          <thead>
            <tr class="border-b border-accented text-left text-xs text-muted">
              <th
                scope="col"
                class="px-2 py-2 font-medium"
              >
                Group
              </th>
              <th
                scope="col"
                class="px-2 py-2 font-medium"
              >
                Course
              </th>
              <th
                scope="col"
                class="px-2 py-2 text-right font-medium"
              >
                Laps
              </th>
              <th
                scope="col"
                class="px-2 py-2 text-right font-medium"
              >
                Distance
              </th>
              <th
                scope="col"
                class="px-2 py-2 text-right font-medium"
              >
                Elevation
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="group in statement.groups"
              :key="group.label"
              class="border-b border-default"
            >
              <td class="px-2 py-2 whitespace-nowrap font-medium text-highlighted">
                {{ group.label }}
              </td>
              <td class="px-2 py-2">
                {{ group.routeName }}
              </td>
              <td class="px-2 py-2 text-right">
                {{ group.laps }}
              </td>
              <td class="px-2 py-2 text-right whitespace-nowrap">
                {{ group.distance }}
              </td>
              <td class="px-2 py-2 text-right whitespace-nowrap">
                {{ group.elevation }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-if="race.sourceUrl || season.organizerUrl"
        class="mt-3 text-sm text-muted"
      >
        <a
          :href="race.sourceUrl ?? season.organizerUrl"
          target="_blank"
          rel="noopener"
          class="text-toned underline decoration-rule-strong hover:text-highlighted"
        >Official event info</a> – signup, full rules and results live with {{ season.organizer }}; we rank the bikes.
      </p>
    </section>

    <EventsDisclaimer
      class="mt-10"
      :organizer="season.organizer"
      :organizer-url="season.organizerUrl"
    />
  </UContainer>
</template>
