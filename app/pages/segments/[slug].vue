<script setup lang="ts">
import type { RaceFormat } from '#shared/utils/events'
import type { Ride, RideCourse } from '../../utils/recommendRequest'
import { draftingAllowed, RACE_FORMATS, ttBikesAllowed } from '#shared/utils/events'
import { rideRulesForFormat } from '../../utils/recommendRequest'
import { surfaceShareFacts, type RideFact } from '../../utils/rideFacts'

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
// LIVE, not applied: these two decide what the rider may PICK, and a control
// offering a value the pending request will discard is the bug they exist to
// prevent. What the results on screen were ranked under is `appliedRide`.
const ttAllowed = computed(() => !raceFormat.value || ttBikesAllowed(raceFormat.value))
const draftAllowed = computed(() => !raceFormat.value || draftingAllowed(raceFormat.value))

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
const canonicalUrl = useCanonicalUrl()
// Everything this page shows about its Ranking - see `useRankingPage`. What
// stays here is what the page states itself: its header, its Race format
// control, its Fact row and Course hero, and its share card. A segment Ride
// has no lap count, so the module rides it once, times the answer over the
// segment's own length and leaves the lap count out of the answer. Its course
// analysis has no climbs tab; the speed chart and TTT plan simulate the
// segment route-style, from a standing start, and their scope lines say so.
const rankingPage = useRankingPage({
  ride: () => ride.value,
  key: `recommend-segment-${slug.value}`,
  rideName: course => segmentData.value ? `the ${course.name} ${segmentData.value.type} in ${course.worldName}` : course.name,
  faqQuestion: () => segmentData.value ? `What's the fastest bike for the ${segmentData.value.name} ${segmentData.value.type}?` : undefined,
  // A segment sits under the segments hub.
  breadcrumbs: () => segmentData.value
    ? [
        { name: 'Home', item: siteConfig.url },
        { name: 'Segments', item: `${siteConfig.url}/segments` },
        { name: segmentData.value.name, item: canonicalUrl.value }
      ]
    : undefined,
  // Off the Applied Ride rather than `isSprint`, so the power and the word
  // for it can never disagree.
  reportSubject: applied => applied?.power === 'sprint' ? 'Sprint segment' : 'Climbing segment'
})
const { tttPlan, bikeSearch, bikeSearchDebounced } = rankingPage
await rankingPage.ready

// `?rules=points&bike=tarmac&category=tt&draft=ttt` - see `useSharedView`. No
// `laps`: there is no lap count here (see the Ride above). `rules` is this
// page's one selection, and "not a race" is the clean URL its link keeps.
useSharedView({ bikeSearch, bikeSearchDebounced }, { key: 'rules', value: raceFormat, values: RACE_FORMATS })

// Stat-rich for SERP snippets: "12.2 km at 8.5%" is what long-tail queries
// ("alpe du zwift gradient") actually contain, and numbers lift click-through
// over boilerplate. The climbing clause is skipped for near-flat segments
// (most sprints) where "0 m of climbing" would be noise.
// Display stats prefer the measured-profile pair when present (see
// `SegmentSummary`) so the snippet, stat cards, OG card and the chart all
// describe the same road.
const displayElevationM = computed(() => segmentData.value ? segmentData.value.measuredElevationM ?? segmentData.value.elevationM : 0)
const displayGradePercent = computed(() => segmentData.value ? segmentData.value.measuredAvgGradePercent ?? segmentData.value.avgGradePercent : 0)

const metaDescription = computed(() => {
  if (!segmentData.value) return undefined
  const s = segmentData.value
  const stats = `${formatDistance(s.lengthKm)}${displayGradePercent.value ? ` at ${formatGrade(displayGradePercent.value)}` : ', flat'}${displayElevationM.value >= 10 ? `, ${formatElevation(displayElevationM.value)} of climbing` : ''}`
  return rideDescription({
    ride: `the ${s.name} ${s.type}`,
    world: s.worldName,
    stats,
    setup: rankingPage.request.topCombo.value ? setupName(rankingPage.request.topCombo.value) : undefined,
    category: rankingPage.request.appliedInputs.value.category
  })
})

useSeoMeta({
  title: () => segmentData.value ? `Fastest bike for the ${segmentData.value.name} ${segmentData.value.type} | ZwiftBikes` : 'ZwiftBikes',
  description: metaDescription,
  ogTitle: () => segmentData.value ? `Fastest bike for the ${segmentData.value.name} ${segmentData.value.type}` : undefined,
  ogDescription: metaDescription
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
if (segmentData.value) {
  const climbType = segmentData.value.climbType
  const kind = segmentData.value.type === 'sprint'
    ? 'sprint'
    : climbType ? `${climbType === 'HC' ? 'HC' : `category ${climbType}`} climb` : 'climb'
  const { frameName, wheelName, silhouette } = rankingPage.shareCard.value
  defineOgImage('SegmentCard', {
    title: segmentData.value.name,
    kind,
    world: segmentData.value.worldName,
    length: formatDistance(segmentData.value.lengthKm),
    elevation: formatElevation(displayElevationM.value),
    grade: displayGradePercent.value ? formatGrade(displayGradePercent.value) : 'Flat',
    frameName,
    wheelName,
    profile: silhouette
  }, {
    alt: `Fastest bike for the ${segmentData.value.name} ${segmentData.value.type} in ${segmentData.value.worldName}: segment profile and the fastest bike and wheel setup`
  })
}

/** The segment in the breadcrumb's words: "Climb, category 2", "Sprint". */
const segmentKind = computed(() => {
  const data = segmentData.value
  if (!data) return ''
  if (data.type === 'sprint') return 'Sprint'
  return data.climbType ? `Climb, ${data.climbType === 'HC' ? 'HC' : `category ${data.climbType}`}` : 'Climb'
})
const facts = computed<RideFact[]>(() => segmentData.value && segmentRoute.value
  ? [
      { value: formatDistance(segmentData.value.lengthKm), label: 'long' },
      { value: formatElevation(displayElevationM.value), label: 'of climbing' },
      { value: displayGradePercent.value ? formatGrade(displayGradePercent.value) : 'Flat', label: 'average grade' },
      ...surfaceShareFacts(segmentRoute.value.surface.composition)
    ]
  : [])
/** Why a lever the Rider card would otherwise offer is fixed here - the format's own rules, in the card's words. */
const ttBarredReason = computed(() => ttAllowed.value || !raceFormat.value ? undefined : `TT frames are barred when this is ridden as a ${raceFormatPhrase(raceFormat.value)}.`)
const draftLockedReason = computed(() => draftAllowed.value ? undefined : 'There is no draft in a Race of Truth.')
</script>

<template>
  <UContainer
    v-if="segmentData && segmentRoute"
    class="pb-8"
  >
    <RideHeading
      :crumbs="[
        { label: 'All segments', to: '/segments' },
        { label: segmentData.worldName },
        { label: segmentKind }
      ]"
      :name="segmentData.name"
    />

    <RideFactRow :facts="facts">
      <li>Timed from the segment's start and ridden once; the flying-start warm-up is not counted.</li>
      <!-- The host routes: how a rider moves on from one stretch to a whole ride. -->
      <li v-if="segmentData.hostRoutes.length">
        Also on
        <template
          v-for="(host, index) in segmentData.hostRoutes"
          :key="host.slug"
        >
          <NuxtLink
            :to="`/routes/${host.slug}`"
            class="text-toned underline decoration-rule-strong hover:text-highlighted"
          >{{ host.name }}</NuxtLink><span v-if="index < segmentData.hostRoutes.length - 1">, </span>
        </template>.
      </li>
      <li v-if="segmentData.placement === 'membership'">
        The exact position of this segment along its host routes isn't in our route data, so length and grade come from the segment's own record, and the surface estimate is borrowed from the host route's overall mix.
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
      <template #rider="card">
        <RiderCard
          :rider="card.rider"
          :refreshing="card.refreshing"
          :has-long-climb="card.hasLongClimb"
          :sprint-power="isSprint"
          :draft-locked="draftLockedReason"
          :tt-barred="ttBarredReason"
          :fixed-laps="{ label: 'Once', reason: 'A segment is timed once, from its start' }"
        />
      </template>

      <template #report-link="{ reportLine }">
        <ReportDataLink
          :item="segmentData?.name"
          :ride="reportLine"
        />
      </template>
    </RankingPageBody>
  </UContainer>
</template>
