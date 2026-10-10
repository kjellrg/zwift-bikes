<script setup lang="ts">
import type { RaceFormat } from '#shared/utils/events'
import type { Ride, RideCourse } from '../../utils/recommendRequest'
import { RACE_FORMATS } from '#shared/utils/events'
import { segmentStatement } from '#shared/utils/rideStatement'
import { rideRulesForFormat } from '../../utils/recommendRequest'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
// The identity this page ranks, and the one it looks up - one spelling, so
// the two cannot disagree about which kind of course it is.
const course = computed<RideCourse>(() => ({ kind: 'segment', slug: slug.value }))
// The segment's summary and the synthetic segment-as-route the server ranks
// against, which carries the segment's sliced elevation profile and surface
// breakdown (see `routeWithMetaForSegment`). Positional segments on a
// measured host get a real profile; membership segments don't, and the chart
// hides itself. The same lookup the request makes for its applied course,
// under the same key - see `useCourse`.
const { ready: segmentReady, segment: segmentData, course: segmentRoute, error: segmentError } = useCourse(() => course.value)
await segmentReady
if (segmentError.value) throw createError({ statusCode: 404, statusMessage: 'Segment not found', fatal: true })

// Sprint segments rank at the rider's separate sprint power (see
// `sprintPowerW` in `useRiderProfile`); everything else at their normal
// power. `segmentData` resolves in setup (awaited fetch above), so the Ride
// below knows which one it is before the first ranking is asked for - which
// is why the segment lookup is awaited first rather than fired alongside it.
const isSprint = computed(() => segmentData.value?.type === 'sprint')

/**
 * The Race format this segment is being ridden under, if any - the page's own
 * selection, the way a route page's is its lap count (see **Race format** and
 * **Shared view** in `CONTEXT.md`). `undefined` is "not a race": the ordinary
 * catalog-wide ranking this page has always shown, and the value a clean link
 * omits.
 *
 * Deliberately NOT the race it came from. A scoring sprint is reached from a
 * race page carrying `?rules=points`, which is the rule and not the identity:
 * the page needs no events data to honour it, and the link doesn't decay when
 * the race retires. It is page-local for the same reason the lap count is -
 * never stored, never carried to the next ranking page.
 */
const raceFormat = ref<RaceFormat>()
const RIDE_RULES_NONE = 'none'
/**
 * Every format, in display order - most-common first rather than the schema's
 * order, since a rider reaching this control has usually come from a points or
 * scratch race. Built from `RACE_FORMATS` through a `Record` the compiler
 * checks is exhaustive, because the link accepts exactly that list: a format
 * accepted from a link but missing here is one a rider cannot reproduce
 * through the control.
 *
 * `ttt` earns its place even though it changes no ranking: it answers "what am
 * I riding this in", and it keeps the race page from having to branch on its
 * own format when it builds the link.
 */
const RIDE_RULES_ORDER: Record<RaceFormat, number> = { points: 0, scratch: 1, ttt: 2, rot: 3 }
const rideRulesOptions = [
  { label: 'Not a race', value: RIDE_RULES_NONE },
  ...[...RACE_FORMATS]
    .sort((a, b) => RIDE_RULES_ORDER[a] - RIDE_RULES_ORDER[b])
    .map(value => ({ label: RACE_FORMAT_LABELS[value], value }))
]
// "Not a race" is the absence of a format, but a select needs a value for it.
const rideRulesSelection = computed({
  get: () => raceFormat.value ?? RIDE_RULES_NONE,
  set: value => raceFormat.value = value === RIDE_RULES_NONE ? undefined : value
})
/**
 * No lap count: a segment is ridden exactly once and its endpoint has no lap
 * parameter. With no fatigue model, which lap of a host route a `perLap`
 * segment falls on doesn't change its physics - unlike a whole route, where
 * lap count changes the total distance.
 *
 * The format's rules ride along when there is one. `useRecommendRequest` then
 * makes the rider's stored settings legal for it exactly as it does on a race
 * page - a stored `tt` category ranks across all legal categories where TT
 * frames are outlawed, a Race of Truth ranks solo - without either stored
 * preference being touched.
 */
const ride = computed<Ride>(() => ({
  course: course.value,
  power: isSprint.value ? 'sprint' : 'race',
  ...rideRulesForFormat(raceFormat.value)
}))

const siteConfig = useSiteConfig()
// Everything this page shows about its Ranking - see `useRankingPage` - and
// everything it says about its Ride on its own, in its Ride statement (see
// `segmentStatement`), Race format rules and draft nudge included. What
// stays here is the page's selection - its Race format - its markup and its
// share card. A segment Ride has no lap count, so the module rides it once,
// times the answer over the segment's own length and leaves the lap count
// out of the answer. Its course analysis has no climbs tab; the speed chart
// and TTT plan simulate the segment route-style, from a standing start, and
// their scope lines say so.
const rankingPage = useRankingPage({
  ride: () => ride.value,
  key: `recommend-segment-${slug.value}`,
  statement: answer => segmentData.value && segmentStatement({ segment: segmentData.value, course: segmentRoute.value, ride: ride.value, siteUrl: siteConfig.url, answer })
})
const { statement, rules, tttPlan, bikeSearch, bikeSearchDebounced } = rankingPage
await rankingPage.ready

// `?rules=points&bike=tarmac&category=tt&draft=ttt` - see `useSharedView`. No
// `laps`: there is no lap count here (see the Ride above). `rules` is this
// page's one selection, and "not a race" is the clean URL its link keeps.
useSharedView({ bikeSearch, bikeSearchDebounced }, { key: 'rules', value: raceFormat, values: RACE_FORMATS })

useSeoMeta({
  title: () => statement.value?.title ?? 'ZwiftBikes',
  description: () => statement.value?.description,
  ogTitle: () => statement.value?.ogTitle,
  ogDescription: () => statement.value?.ogDescription
  // No ogImage/twitterImage here: `defineOgImage` below emits og:image (with
  // width/height/alt) and the twitter:image set itself, same as the route page.
})

// Issue #59 phase 2: a generated card replaces the old hotlinked world
// minimap, now that #56 made segment pages prerenderable. Snapshotted once
// at setup, which is exactly the build-time prerender pass (zeroRuntime
// never re-renders): rank 1 is therefore the DEFAULT rider profile's - the
// same ranking the prerendered page itself shows. See `RankingPageShareCard`,
// whose Silhouette is the measured slice or nothing, like the page's own
// chart - never the 2-point synthetic ramp.
if (statement.value) {
  const { props: card, alt } = statement.value.shareCard
  const { frameName, wheelName, silhouette } = rankingPage.shareCard.value
  defineOgImage('SegmentCard', { ...card, frameName, wheelName, profile: silhouette }, { alt })
}

/**
 * The draft nudge, until the rider dismisses it - for the visit, as on a race
 * page, or until they pick another format, whose nudge is news again.
 */
const draftNudgeDismissed = ref(false)
watch(raceFormat, () => {
  draftNudgeDismissed.value = false
})
</script>

<template>
  <UContainer
    v-if="segmentData && segmentRoute && statement"
    class="pb-8"
  >
    <RideHeading
      :crumbs="statement.heading.crumbs"
      :name="statement.heading.name"
    />

    <RideFactRow
      :facts="statement.facts"
      :surface="statement.surface"
    >
      <li>{{ statement.timingNote }}</li>
      <!-- The host routes: how a rider moves on from one stretch to a whole ride. -->
      <li v-if="statement.hostRoutes.length">
        Also on
        <template
          v-for="(host, index) in statement.hostRoutes"
          :key="host.to"
        >
          <NuxtLink
            :to="host.to"
            class="text-toned underline decoration-rule-strong hover:text-highlighted"
          >{{ host.name }}</NuxtLink><span v-if="index < statement.hostRoutes.length - 1">, </span>
        </template>.
      </li>
      <li v-if="statement.placementNote">
        {{ statement.placementNote }}
      </li>
      <TttFactLine
        v-if="tttPlan"
        :plan="tttPlan"
      />
    </RideFactRow>

    <!-- The page's own selection, with the Ride and above the answer the way
         a route page's lap count is - deliberately not with the equipment
         chips, whose contract is stored rider preferences. -->
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <label
        for="segment-ridden-as"
        class="text-sm text-muted"
      >Ridden as</label>
      <USelectMenu
        id="segment-ridden-as"
        v-model="rideRulesSelection"
        value-key="value"
        :items="rideRulesOptions"
        :search-input="false"
        size="sm"
        class="w-44"
        aria-label="Ridden as"
      />
    </div>

    <CourseHero
      :route="segmentRoute"
      :laps="1"
      :name="segmentData.name"
    />

    <RankingPageBody :page="rankingPage">
      <!-- A segment told a format "is ranked as that race is raced", so it
           nudges towards the format's draft mode as a race page does. -->
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
          :sprint-power="isSprint"
          :draft-locked="card.draftLocked"
          :tt-barred="card.ttBarred"
          :fixed-laps="{ label: 'Once', reason: 'A segment is timed once, from its start' }"
        />
      </template>

      <template #report-link="{ reportLine }">
        <ReportDataLink
          :item="statement.reportItem"
          :ride="reportLine"
        />
      </template>
    </RankingPageBody>
  </UContainer>
</template>
