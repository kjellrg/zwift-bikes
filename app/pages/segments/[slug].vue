<script setup lang="ts">
import type { RaceFormat } from '#shared/utils/events'
import type { Ride, RideCourse } from '../../utils/recommendRequest'
import { draftingAllowed, RACE_FORMATS, ttBikesAllowed } from '#shared/utils/events'
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { rideForSegment } from '#shared/utils/recommendRide'
import { routeSilhouette } from '#shared/utils/silhouette'
import { rideRulesForFormat } from '../../utils/recommendRequest'
import { breadcrumbScript, faqScript } from '../../utils/rankingResults'
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

const resolvedRide = computed(() => segmentRoute.value ? rideForSegment(segmentRoute.value) : undefined)

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
// Handed whole to `RideResults`, which renders everything this page shows
// about the Ranking; what is destructured here is what the page itself is
// still about - its header, its race-format control, its Fact row and its
// analysis.
const request = useRecommendRequest(() => ride.value, { key: `recommend-segment-${slug.value}` })
const {
  ready: recommendReady, recommendData, physics: physicsInfo,
  combos, topCombo, fastestTimeSec, appliedInputs, appliedRanking, wheelChoice, appliedRide, appliedRestrictions,
  isFirstLoad, isRefreshing, resultsAnnouncement, bikeSearch, bikeSearchDebounced
} = request
await recommendReady

/**
 * What a report filed from this page says the ranking was ridden as - see
 * `formatRideLine`. The kind comes off the applied Ride rather than
 * `isSprint`, so the power and the word for it can never disagree.
 */
const reportRideLine = computed(() => formatRideLine({
  subject: appliedRide.value?.power === 'sprint' ? 'Sprint segment' : 'Climbing segment',
  ride: appliedRide.value,
  rider: appliedInputs.value
}))

// `?rules=points&bike=tarmac&category=tt&draft=ttt` - see `useSharedView`. No
// `laps`: there is no lap count here (see the Ride above). `rules` is this
// page's one selection, and "not a race" is the clean URL its link keeps.
useSharedView({ bikeSearch, bikeSearchDebounced }, { key: 'rules', value: raceFormat, values: RACE_FORMATS })

// Read-only here: the levers that write them live in `RiderCard` and
// `RideEquipmentFilters` - see the equivalent comment in `routes/[slug].vue`.
const { weightKg, powerW } = useRiderProfile()

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
  return `The best bike and wheels for the ${s.name} ${s.type} in ${s.worldName} - ${stats} - ranked by predicted time for your weight and power.`
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
// never re-renders): the top combo is therefore the DEFAULT rider profile's
// - the same ranking the prerendered page itself shows - and combo names,
// not a finish time, go on the card because a time is only meaningful for a
// specific rider. The profile strip is gated exactly like the page's own
// chart: measured slice or nothing, never the 2-point synthetic ramp.
if (segmentData.value) {
  const ogTopCombo = recommendData.value?.combos?.[0]
  const measuredProfile = segmentRoute.value?.terrain.elevationProfile
  const climbType = segmentData.value.climbType
  const kind = segmentData.value.type === 'sprint'
    ? 'sprint'
    : climbType ? `${climbType === 'HC' ? 'HC' : `category ${climbType}`} climb` : 'climb'
  defineOgImage('SegmentCard', {
    title: segmentData.value.name,
    kind,
    world: segmentData.value.worldName,
    length: formatDistance(segmentData.value.lengthKm),
    elevation: formatElevation(displayElevationM.value),
    grade: displayGradePercent.value ? formatGrade(displayGradePercent.value) : 'Flat',
    frameName: ogTopCombo?.frame.name,
    wheelName: ogTopCombo?.wheelset?.name,
    profile: measuredProfile && measuredProfile.length > 1
      ? ogProfile(routeSilhouette(segmentRoute.value!, 1, { samples: 120 }))
      : undefined
  }, {
    alt: `Fastest bike for the ${segmentData.value.name} ${segmentData.value.type} in ${segmentData.value.worldName}: segment profile and the fastest bike and wheel setup`
  })
}

// Whether the team climb pace lever is worth showing - see the
// `hasLongClimb` prop on `RiderCard`. Keyed on the rider's NORMAL
// power, never on `tttClimbWkg`, so the climb pace can't decide its own
// slider's visibility.
const hasLongClimb = computed(() => resolvedRide.value
  ? detectLongClimbBlocks(resolvedRide.value.planGeometry(), powerW.value, weightKg.value).length > 0
  : true)

// One plan for the Fact row's TTT line and the TTT plan tab - see
// `useTttPlan`. One lap: the timed segment, with no lead-in.
const tttPlan = useTttPlan({
  route: () => segmentRoute.value,
  combo: () => topCombo.value,
  rider: () => appliedInputs.value,
  laps: () => 1,
  loading: () => isFirstLoad.value
})

// Also handed whole to `RideResults`, so the recommendation and the rows
// pick through one set of picks; the section they are compared in renders
// below, in this page's own flow, which is where "Show comparison" scrolls.
const comparison = useComparison(() => combos.value)
const { picked: comparedCombos, clear: clearComparison, remove: removeFromComparison } = comparison

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

const faqQuestion = computed(() => segmentData.value ? `What's the fastest bike for the ${segmentData.value.name} ${segmentData.value.type}?` : undefined)
// The visible answer under the recommendation and the FAQ structured data
// are one text (`answer.text`), built from the APPLIED ranking - the rider
// the request was actually answered for, sprint power included - so what a
// crawler reads is what a rider sees. No `laps`: the answer then
// names the timed-segment scope instead. Renders from the prerendered
// results on first paint; during a refetch it keeps describing the results
// still on screen, the same way the dimmed results do.
const answer = useRecommendationAnswer({
  combo: () => topCombo.value,
  rideName: () => segmentData.value ? `the ${segmentData.value.name} ${segmentData.value.type} in ${segmentData.value.worldName}` : undefined,
  distanceKm: () => segmentData.value?.lengthKm,
  rider: () => appliedInputs.value,
  restrictions: () => appliedRestrictions.value,
  // APPLIED, unlike the two control props above: this explains the times on
  // screen, so it must name the format they were ranked under. Same wording
  // as the race page's, from `rideRulesLine`.
  rideRules: () => appliedRide.value?.raceFormat ? rideRulesLine(appliedRide.value.raceFormat) : undefined
})
const faqAnswer = computed(() => answer.value?.text)

const siteConfig = useSiteConfig()
const canonicalUrl = useCanonicalUrl()
useHead(() => {
  if (!segmentData.value) return {}
  // The trail is this page's own - a segment sits under the segments hub -
  // and the envelope, the keying and the escaping are `rankingResults.ts`'s.
  return {
    script: [
      breadcrumbScript([
        { name: 'Home', item: siteConfig.url },
        { name: 'Segments', item: `${siteConfig.url}/segments` },
        { name: segmentData.value.name, item: canonicalUrl.value }
      ]),
      faqScript(faqQuestion.value, faqAnswer.value)
    ].filter(script => script !== undefined)
  }
})
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

    <RecommendDataNotice class="mt-6" />
    <p
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ resultsAnnouncement }}
    </p>

    <RideResults
      :request="request"
      :comparison="comparison"
      :answer="answer"
      :faq-question="faqQuestion"
      :hide-tt-category="!ttAllowed"
    >
      <template #rider>
        <RiderCard
          :rider="appliedInputs"
          :refreshing="isRefreshing"
          :has-long-climb="hasLongClimb"
          :sprint-power="isSprint"
          :draft-locked="draftLockedReason"
          :tt-barred="ttBarredReason"
          :fixed-laps="{ label: 'Once', reason: 'A segment is timed once, from its start' }"
        />
      </template>

      <template #report-link>
        <ReportDataLink
          :item="segmentData?.name"
          :ride="reportRideLine"
        />
      </template>
    </RideResults>

    <!-- A segment is ridden once, so both lap counts are 1 and there is no
         climbs tab. The speed chart and TTT plan simulate the segment
         route-style, from a standing start, and their scope lines say so. -->
    <div class="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-2">
      <RideWhy
        :course="appliedRanking.course"
        :combo="topCombo"
        :ride-name="segmentData.name"
        :physics-mode="physicsInfo?.mode"
        :draft-mode="appliedInputs.draftMode"
        :wheel-choice="wheelChoice"
        :refreshing="isRefreshing"
      />
      <RideCourseAnalysis
        :route="segmentRoute"
        :results-route="appliedRanking.course"
        :kind="segmentData.type"
        :laps="1"
        :results-laps="1"
        :combo="topCombo"
        :rider="appliedInputs"
        :refreshing="isRefreshing"
        :loading="isFirstLoad"
        :plan="tttPlan"
      />
    </div>

    <RideComparison
      class="mt-16"
      :combos="comparedCombos"
      :fastest-time-sec="fastestTimeSec"
      @clear="clearComparison"
      @remove="removeFromComparison"
    />

    <PhysicsNote
      v-if="physicsInfo"
      class="mt-12"
      :mode="physicsInfo.mode"
      :summary="physicsInfo.summary"
      :note="physicsInfo.note"
    />
  </UContainer>
</template>
