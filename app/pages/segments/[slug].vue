<script setup lang="ts">
import type { RaceFormat } from '#shared/utils/events'
import type { Ride } from '../../utils/recommendRequest'
import { draftingAllowed, RACE_FORMATS, ttBikesAllowed } from '#shared/utils/events'
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { rideForSegment } from '#shared/utils/recommendRide'
import { rideRulesForFormat } from '../../utils/recommendRequest'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const { data: segmentData, error: segmentError } = await useFetch(() => `/api/segments/${slug.value}`)
if (segmentError.value) throw createError({ statusCode: 404, statusMessage: 'Segment not found', fatal: true })

// The synthetic segment-as-route the server ranks against - carries the
// segment's sliced elevation profile and surface breakdown (see
// `routeWithMetaForSegment`). Positional segments on a measured host get a
// real profile; membership segments don't, and the chart hides itself.
const segmentRoute = computed(() => segmentData.value?.route)
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
  endpoint: `/api/recommend/segments/${slug.value}`,
  power: isSprint.value ? 'sprint' : 'race',
  ...rideRulesForFormat(raceFormat.value)
}))
const {
  ready: recommendReady, recommendData, physics: physicsInfo, fastestOverall,
  combos, topCombo, fastestTimeSec, hasMore, loadingMore, showMore,
  appliedInputs, appliedRide, appliedRestrictions, canShowMore,
  hasRanking, isFirstLoad, isRefreshing, refreshFailed, expansionFailed, retry,
  resultsAnnouncement, bikeSearch, bikeSearchDebounced, loadWheelOptions, appliedRequestKey
} = useRecommendRequest(() => ride.value, { key: `recommend-segment-${slug.value}` })
await recommendReady

/**
 * What a report filed from this page says the ranking was ridden as - see
 * `formatRideLine`. The kind comes off the applied Ride rather than
 * `isSprint`, so the power and the word for it can never disagree.
 */
const reportRideLine = computed(() => formatRideLine({
  subject: appliedRide.value.power === 'sprint' ? 'Sprint segment' : 'Climbing segment',
  ride: appliedRide.value,
  rider: appliedInputs.value
}))

// `?rules=points&bike=tarmac&category=tt&draft=ttt` - see `useSharedView`. No
// `laps`: there is no lap count here (see the Ride above). `rules` is this
// page's one selection, and "not a race" is the clean URL its link keeps.
useSharedView({ bikeSearch, bikeSearchDebounced }, { key: 'rules', value: raceFormat, values: RACE_FORMATS })

// Read-only here: the controls that write them live in
// `RiderProfileControls` / `RideEquipmentFilters` - see the equivalent
// comment in `routes/[slug].vue`.
const { weightKg, powerW } = useRiderProfile()
const { setBikeCategory, setIncludeHaloBikes } = usePreferences()

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
  return `Find the fastest bike and wheel combo for the ${s.name} ${s.type} in ${s.worldName} - ${stats}.`
})

useSeoMeta({
  title: () => segmentData.value ? `Best Bike for the ${segmentData.value.name} ${segmentData.value.type} - ZwiftBikes` : 'ZwiftBikes',
  description: metaDescription,
  ogTitle: () => segmentData.value ? segmentData.value.name : undefined,
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
  const kind = segmentData.value.type === 'climb'
    ? `${segmentData.value.climbType ? (segmentData.value.climbType === 'HC' ? 'HC ' : `CAT ${segmentData.value.climbType} `) : ''}CLIMB`
    : 'SPRINT'
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
      ? ogProfileFromPoints(resolvedRide.value!.planGeometry().points)
      : undefined
  }, {
    alt: `Best bike for the ${segmentData.value.name} ${segmentData.value.type} in ${segmentData.value.worldName}: segment profile and the fastest bike and wheel setup`
  })
}

// Tells the open bike drawer whether its bike is still on a loaded page - see
// `noteRankedFrames`. The applied Ride goes with it now that this page can bar
// TT frames: a bike missing because the format outlaws it has not been beaten
// by anything, and the drawer must say so rather than call it slow.
const { noteRankedFrames } = useOverlays()
watch(combos, list => noteRankedFrames(list, appliedRide.value), { immediate: true })

// Whether the team climb pace control is worth showing - see the
// `hasLongClimb` prop on `RiderProfileControls`. Keyed on the rider's NORMAL
// power, never on `tttClimbWkg`, so the climb pace can't decide its own
// slider's visibility.
const hasLongClimb = computed(() => resolvedRide.value
  ? detectLongClimbBlocks(resolvedRide.value.planGeometry(), powerW.value, weightKg.value).length > 0
  : true)

const physicsIsDynamic = computed(() => physicsInfo.value?.mode === 'dynamic')
const surfaceTimePenaltyText = computed(() => segmentRoute.value ? formatSurfaceTimePenalty(segmentRoute.value.surface, topCombo.value?.surfaceTimePenaltySec) : undefined)
const tttSavingText = computed(() => formatTttTimeSaving(physicsInfo.value?.ttt))
const raceSavingText = computed(() => formatRaceTimeSaving(physicsInfo.value?.race))
// The evidence lines under the recommended time - each is about the fastest
// combo, so they sit with it rather than under the segment header.
const recommendationNotes = computed(() => [surfaceTimePenaltyText.value, tttSavingText.value, raceSavingText.value]
  .filter((note): note is string => Boolean(note)))
const hasElevationProfile = computed(() => (segmentRoute.value?.terrain.elevationProfile?.length ?? 0) > 1)
const limitedDataNote = computed(() => segmentRoute.value
  ? limitedCourseDataNote({
      hasElevationProfile: hasElevationProfile.value,
      hasSurfaceLocations: (segmentRoute.value.surface.segments?.length ?? 0) > 0
    })
  : undefined)
// One plan for the briefing's TTT line and the TTT plan tab - see
// `useTttPlan`. One lap: the timed segment, with no lead-in.
const tttPlan = useTttPlan({
  route: () => segmentRoute.value,
  combo: () => topCombo.value,
  rider: () => appliedInputs.value,
  laps: () => 1,
  loading: () => isFirstLoad.value
})

const {
  keys: comparisonKeys, picked: comparedCombos, full: comparisonFull,
  includes: isCompared, toggle: toggleCompared,
  clear: clearComparison, remove: removeFromComparison
} = useComparison(() => combos.value)

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
  rideRules: () => appliedRide.value.raceFormat ? rideRulesLine(appliedRide.value.raceFormat) : undefined
})
const faqAnswer = computed(() => answer.value?.text)

const siteConfig = useSiteConfig()
const canonicalUrl = useCanonicalUrl()
useHead(() => {
  if (!segmentData.value) return {}
  // Keyed, so unhead updates the server-rendered tag in place. Without a
  // key it matches by content hash, and a patch that lands while the page
  // is still hydrating - the stored profile's ranking is accepted - inserts a second FAQ script and
  // leaves the crawler-facing default-rider one in the document.
  const scripts = [{
    key: 'breadcrumbs',
    type: 'application/ld+json' as const,
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
        { '@type': 'ListItem', 'position': 2, 'name': 'Segments', 'item': `${siteConfig.url}/segments` },
        { '@type': 'ListItem', 'position': 3, 'name': segmentData.value.name, 'item': canonicalUrl.value }
      ]
    }).replace(/</g, '\\u003c')
  }]
  if (faqAnswer.value) {
    scripts.push({
      key: 'faq',
      type: 'application/ld+json' as const,
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        'mainEntity': [{
          '@type': 'Question',
          'name': faqQuestion.value,
          'acceptedAnswer': { '@type': 'Answer', 'text': faqAnswer.value }
        }]
      }).replace(/</g, '\\u003c')
    })
  }
  return { script: scripts }
})
</script>

<template>
  <UContainer
    v-if="segmentData && segmentRoute"
    class="py-8 space-y-8"
  >
    <div class="space-y-6">
      <div class="flex flex-wrap items-center gap-3 text-sm text-muted">
        <UButton
          to="/segments"
          variant="link"
          color="neutral"
          icon="i-lucide-arrow-left"
          class="px-0"
        >
          All segments
        </UButton>
        <span class="border-l border-default pl-3">{{ segmentData.worldName }} / {{ segmentData.type }}</span>
      </div>
      <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
            Your next ride
          </p>
          <h1 class="mt-1 text-3xl font-bold text-highlighted break-words sm:text-4xl">
            {{ segmentData.name }}
          </h1>
          <div class="mt-3 flex flex-wrap gap-2">
            <UBadge
              :color="segmentData.type === 'climb' ? 'success' : 'warning'"
              variant="subtle"
              :icon="segmentData.type === 'climb' ? 'i-lucide-mountain' : 'i-lucide-zap'"
            >
              {{ segmentData.type === "climb" ? "Climb" : "Sprint" }}
            </UBadge>
            <UBadge
              v-if="segmentData.climbType"
              :color="CLIMB_TYPE_COLORS[segmentData.climbType]"
              variant="subtle"
            >
              {{ segmentData.climbType === "HC" ? "HC" : `Cat ${segmentData.climbType}` }}
            </UBadge>
            <SurfaceBadges :surface="segmentRoute.surface" />
            <UBadge
              v-if="physicsIsDynamic"
              color="primary"
              variant="subtle"
              icon="i-lucide-atom"
            >
              Dynamic physics
            </UBadge>
          </div>
        </div>
        <dl class="grid shrink-0 grid-cols-3 gap-4 sm:gap-8">
          <div>
            <dt class="text-xs text-muted">
              Length
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ formatDistance(segmentData.lengthKm) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Elevation
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ formatElevation(displayElevationM) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">
              Avg grade
            </dt><dd class="text-xl font-bold tabular-nums text-highlighted sm:text-2xl">
              {{ displayGradePercent ? formatGrade(displayGradePercent) : "Flat" }}
            </dd>
          </div>
        </dl>
      </div>
      <!-- The page's own selection, with the Ride and above the results the
           way a route page's lap picker is - and deliberately NOT in
           `RideEquipmentFilters`, whose contract is stored rider preferences.
           No alert banner goes with it: a control naming the format sits
           directly over the ranking it changes, which is exactly what a race
           page hasn't got. -->
      <div class="w-56">
        <label class="block text-xs font-medium text-muted mb-1">Ridden as</label><USelectMenu
          v-model="rideRulesSelection"
          value-key="value"
          :items="rideRulesOptions"
          :search-input="false"
          aria-label="Ridden as"
        />
      </div>
      <RideRiderSummary
        :rider="appliedInputs"
        :refreshing="isRefreshing"
        :has-long-climb="hasLongClimb"
        :sprint-power="isSprint"
        :draft-locked="!draftAllowed"
      />
      <RideEquipmentFilters
        :hide-tt-category="!ttAllowed"
        :applied-restrictions="appliedRestrictions"
      />
    </div>

    <RecommendDataNotice />
    <p
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ resultsAnnouncement }}
    </p>

    <RideRefreshNotice
      :failed="refreshFailed"
      :has-results="hasRanking"
      @retry="retry"
    />

    <!-- The recommendation is first in source order and first on a phone;
         on a desktop the briefing takes the left column and the
         recommendation the wider right one. The briefing reads only the
         Ride, so it renders through a refetch and with no matches. -->
    <div
      id="ride-results"
      class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12"
      :aria-busy="isFirstLoad || isRefreshing"
    >
      <div class="lg:col-start-2 lg:row-start-1 lg:border-l lg:border-default lg:pl-12">
        <div
          v-if="isFirstLoad"
          class="space-y-4"
        >
          <RideRecommendationSkeleton />
        </div>
        <template v-else>
          <p
            v-if="isRefreshing"
            class="mb-3 flex items-center gap-1.5 text-sm text-muted"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-4 animate-spin"
            />Updating results…
          </p>
          <div
            class="transition-opacity"
            :class="{ 'opacity-60': isRefreshing }"
          >
            <!-- `laps` is 1 on purpose: the synthetic segment-as-route has no
                 lead-in, so the km/h beside the time divides the segment's own
                 length by a time that starts at its timed start. -->
            <RideRecommendation
              v-if="topCombo"
              :combo="topCombo"
              :route="segmentRoute"
              :laps="1"
              :fastest-time-sec="fastestTimeSec"
              :load-wheel-options="loadWheelOptions"
              :request-key="appliedRequestKey"
              :limited-data-note="limitedDataNote"
              :notes="recommendationNotes"
              :compared="isCompared(topCombo)"
              :compare-disabled="comparisonFull && !isCompared(topCombo)"
              :compare-count="comparisonKeys.length"
              @toggle-compare="toggleCompared(topCombo)"
            >
              <template #fastest-overall>
                <!-- `pointer-events-auto`: the wrapper blocks clicks on stale
                     results while a refetch runs, but the reveal is a filter
                     change, not a stale result, and stays usable as before. -->
                <FastestOverallNote
                  v-if="fastestOverall"
                  :fastest-overall="fastestOverall"
                  class="mb-0 pointer-events-auto"
                  @show-all="setBikeCategory('all')"
                  @include-halo="setIncludeHaloBikes(true)"
                />
              </template>
            </RideRecommendation>
            <section
              v-else
              aria-label="Recommended setup"
              class="space-y-4"
            >
              <p class="text-muted">
                No bikes match your filters.
                <template v-if="appliedRestrictions.search">
                  Clear the search below or widen the filters above to see the ranking again.
                </template>
                <template v-else>
                  Widen the filters above to see the ranking again.
                </template>
              </p>
              <FastestOverallNote
                v-if="fastestOverall"
                :fastest-overall="fastestOverall"
                class="mb-0 pointer-events-auto"
                @show-all="setBikeCategory('all')"
                @include-halo="setIncludeHaloBikes(true)"
              />
              <ul
                v-if="recommendationNotes.length"
                class="space-y-1 text-sm text-muted"
              >
                <li
                  v-for="note in recommendationNotes"
                  :key="note"
                >
                  {{ note }}
                </li>
              </ul>
            </section>
          </div>
        </template>
      </div>
      <!-- The host-route links live here rather than under the header: they
           are how a rider moves on to a whole ride, and the briefing is the
           part of the page that describes the ride they are on. -->
      <RideBriefing
        :route="segmentRoute"
        :kind="isSprint ? 'Sprint segment' : 'Climbing segment'"
        class="lg:col-start-1 lg:row-start-1"
      >
        <li>
          Timed from the segment's start, ridden once; the flying-start warm-up is not counted.
        </li>
        <li v-if="segmentData.hostRoutes.length">
          <span class="font-medium text-highlighted">Also appears on:</span>
          <template
            v-for="(host, index) in segmentData.hostRoutes"
            :key="host.slug"
          >
            <ULink
              :to="`/routes/${host.slug}`"
              class="text-primary underline"
            >{{ host.name }}</ULink><span v-if="index < segmentData.hostRoutes.length - 1">, </span>
          </template>
        </li>
        <TttBriefingLine
          v-if="tttPlan"
          :plan="tttPlan"
        />
        <li
          v-if="segmentData.placement === 'membership'"
          class="text-xs"
        >
          The exact position of this segment along its host routes isn't in our route data, so length and grade come from the segment's own record, and the surface estimate is borrowed from the host route's overall mix.
        </li>
      </RideBriefing>
    </div>

    <!-- Full width beneath both columns: the answer the page's title asks
         for, with its assumptions on a smaller line - see the route page. -->
    <section
      v-if="answer"
      aria-labelledby="ride-answer-heading"
      class="border-y border-default py-5"
    >
      <h2
        id="ride-answer-heading"
        class="text-lg font-semibold text-highlighted"
      >
        {{ faqQuestion }}
      </h2>
      <p class="mt-2 text-muted">
        {{ answer.summary }}
      </p>
      <p class="mt-1 text-xs text-muted">
        {{ answer.assumptions }}
      </p>
    </section>

    <div
      v-if="!isFirstLoad"
      class="transition-opacity"
      :class="{ 'opacity-60': isRefreshing }"
    >
      <RideAlternatives
        v-model:search="bikeSearch"
        v-model:selected="comparisonKeys"
        :combos="combos"
        :route="segmentRoute"
        :laps="1"
        :fastest-time-sec="fastestTimeSec"
        :load-wheel-options="loadWheelOptions"
        :request-key="appliedRequestKey"
        :has-more="hasMore"
        :can-show-more="canShowMore"
        :applied-search="appliedRestrictions.search"
        :loading-more="loadingMore"
        :expansion-failed="expansionFailed"
        @show-more="showMore"
      />
      <ReportDataLink
        :item="segmentData?.name"
        :ride="reportRideLine"
      />
    </div>

    <!-- A segment is ridden once, so both lap counts are 1 and there is no
         Segments tab. The speed chart and TTT plan simulate the segment
         route-style, from a standing start, and their scope lines say so. -->
    <RideCourseAnalysis
      :route="segmentRoute"
      :kind="segmentData.type"
      :laps="1"
      :results-laps="1"
      :combo="topCombo"
      :rider="appliedInputs"
      :refreshing="isRefreshing"
      :loading="isFirstLoad"
      :plan="tttPlan"
    />

    <RideComparison
      :combos="comparedCombos"
      :fastest-time-sec="fastestTimeSec"
      @clear="clearComparison"
      @remove="removeFromComparison"
    />

    <PhysicsNote
      v-if="physicsInfo"
      :mode="physicsInfo.mode"
      :summary="physicsInfo.summary"
      :note="physicsInfo.note"
    />
  </UContainer>
</template>
