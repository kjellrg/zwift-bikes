<script setup lang="ts">
import type { RecommendRequestState } from '../composables/useRecommendRequest'
import type { useComparison } from '../composables/useComparison'
import type { RecommendationAnswer } from '../utils/recommendationAnswer'
import { rankingEvidence } from '../utils/rankingResults'

/**
 * The Ranking results: everything a ranking page shows ABOUT its Applied
 * Ranking - see the term in `CONTEXT.md`. The Recommendation, its evidence
 * lines, the answer the page's title asks for, the ranking beneath it, and
 * what all of that looks like while it is being refreshed or when nothing
 * matched.
 *
 * One module for the route, segment and race pages, which is the whole point
 * of it: twelve of the seventeen commits that touched the route page since
 * August touched all three at once, each one writing the same behaviour out
 * three times. What stays with a page is what is genuinely its own - its
 * header, its selection control, its briefing, its course analysis, and the
 * decision of whether there is a ranking to show at all.
 *
 * There is deliberately no page-kind prop. Every page-specific difference
 * here is a slot or a prop; a `kind` would be a licence to grow a branch per
 * page inside this file, which is the triplication back in one place and
 * harder to see.
 */
const props = defineProps<{
  /**
   * The page's recommend request, whole. Destructured once below rather than
   * read through `props.request` in the markup - a plain object's nested refs
   * do not auto-unwrap in a template, and setup-returned ones do.
   *
   * Safe to destructure because a page creates exactly one
   * `useRecommendRequest` instance, whose object identity never changes; what
   * moves is inside the refs.
   */
  request: RecommendRequestState
  /**
   * The page's comparison picks. The Recommendation is rank 1 of this same
   * Ranking, so it picks through them exactly as a row does - one pick path,
   * shared with `RideAlternatives` below.
   *
   * The bundle stays the page's because the comparison section renders
   * further down, in the page's own flow, which is where "Show comparison"
   * scrolls to.
   */
  comparison: ReturnType<typeof useComparison>
  /** The answer under the results; the page holds it too, for its FAQ structured data, so the two texts are one. */
  answer: RecommendationAnswer | undefined
  /** The question the answer section's heading asks, in the page's own words. */
  faqQuestion: string | undefined
}>()

const {
  topCombo, appliedRanking, appliedRestrictions, physics, fastestOverall,
  isFirstLoad, isRefreshing, refreshFailed, hasRanking, retry,
  bikeSearch, hasMore, canShowMore, loadingMore, expansionFailed, showMore
} = props.request
const {
  keys: comparisonKeys, full: comparisonFull, includes: isCompared, toggle: toggleCompared
} = props.comparison

const { setBikeCategory, setIncludeHaloBikes } = usePreferences()

// The evidence lines under the recommended time - each is about the fastest
// combo on the applied course, so they sit with it rather than under the
// page's own header. One derivation for all three pages: `rankingResults.ts`.
const evidence = computed(() => rankingEvidence({
  course: appliedRanking.value.course,
  combo: topCombo.value,
  physics: physics.value
}))
</script>

<template>
  <!--
    A fragment on purpose: these are siblings of the page's own sections in
    one `space-y` container, and a wrapper would put the whole results block
    at one spacing step instead of each part at its own.
  -->
  <slot name="page-block" />

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
          <!-- The Applied Ranking carries the APPLIED course and lap count,
               not whatever the page's own selector is showing: the km/h
               beside the time divides a distance by a time, and the two must
               describe one ride. A segment Ride carries no lap count at all
               (see `Ride.laps`), which the card reads as the one lap it is -
               its synthetic segment-as-route has no lead-in, so that km/h
               divides the segment's own length by a time that starts at its
               timed start. -->
          <RideRecommendation
            v-if="topCombo"
            :combo="topCombo"
            :ranking="appliedRanking"
            :limited-data-note="evidence.limitedDataNote"
            :notes="evidence.notes"
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
              v-if="evidence.notes.length"
              class="space-y-1 text-sm text-muted"
            >
              <li
                v-for="note in evidence.notes"
                :key="note"
              >
                {{ note }}
              </li>
            </ul>
          </section>
        </div>
      </template>
    </div>
    <slot name="briefing" />
  </div>

  <!-- Full width beneath both columns: the answer the page's title asks
       for, with its assumptions on a smaller line. Inside the
       recommendation column it drove the row's height and left the
       briefing beside acres of whitespace. -->
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
      :ranking="appliedRanking"
      :has-more="hasMore"
      :can-show-more="canShowMore"
      :applied-search="appliedRestrictions.search"
      :loading-more="loadingMore"
      :expansion-failed="expansionFailed"
      @show-more="showMore"
    />
    <slot name="report-link" />
  </div>
</template>
