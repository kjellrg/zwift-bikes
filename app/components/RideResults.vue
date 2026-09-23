<script setup lang="ts">
import type { RecommendRequestState } from '../composables/useRecommendRequest'
import type { useComparison } from '../composables/useComparison'
import type { RecommendationAnswer } from '../utils/recommendationAnswer'
import { rankingEvidence } from '../utils/rankingResults'

/**
 * The Ranking results: everything a ranking page shows ABOUT its Applied
 * Ranking - see the term in `CONTEXT.md`. The answer band (the
 * Recommendation, with the page's Rider card beside it), the answer the
 * page's title asks for, the Ranking table beneath, and what all of that
 * looks like while it is being refreshed or when nothing matched.
 *
 * One module for the route, segment and race pages, which is the whole point
 * of it: twelve of the seventeen commits that touched the route page since
 * August touched all three at once, each one writing the same behaviour out
 * three times. What stays with a page is what is genuinely its own - its
 * header, its selection control, its Fact row and Course hero, its Rider
 * card's page-specific facts, its course section, and the decision of
 * whether there is a ranking to show at all.
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
   * The page's comparison picks, which the table's rows toggle - rank 1's
   * row included.
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
  /** Whether the ride bars TT frames - the chips above the table drop the TT value. */
  hideTtCategory?: boolean
}>()

const {
  topCombo, appliedRanking, appliedRestrictions, physics, fastestOverall,
  isFirstLoad, isRefreshing, refreshFailed, hasRanking, retry,
  bikeSearch, hasMore, canShowMore, loadingMore, expansionFailed, showMore
} = props.request
const { keys: comparisonKeys } = props.comparison

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
    A fragment on purpose: these are siblings of the page's own sections,
    and a wrapper would put the whole results block at one spacing step
    instead of each part at its own.
  -->
  <RideRefreshNotice
    :failed="refreshFailed"
    :has-results="hasRanking"
    @retry="retry"
  />

  <!-- The answer band: the Recommendation first in source order and first on
       a phone, the Rider card beside it on a desktop. `aria-busy` covers the
       table too, which is what a refresh replaces. -->
  <div
    id="ride-results"
    :aria-busy="isFirstLoad || isRefreshing"
  >
    <div class="mt-6 grid grid-cols-1 gap-7 border-t border-default pt-5 sm:mt-9 sm:pt-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
      <div class="min-w-0">
        <RideRecommendationSkeleton v-if="isFirstLoad" />
        <div
          v-else
          class="transition-opacity"
          :class="{ 'opacity-60': isRefreshing }"
        >
          <!-- The Applied Ranking carries the APPLIED course and lap count,
               not whatever the page's own selector is showing: the km/h
               beside the time divides a distance by a time, and the two must
               describe one ride. -->
          <RideRecommendation
            v-if="topCombo"
            :combo="topCombo"
            :ranking="appliedRanking"
            :limited-data-note="evidence.limitedDataNote"
            :notes="evidence.notes"
          >
            <template #fastest-overall>
              <!-- `pointer-events-auto`: the reveal is a filter change, not a
                   stale result, and stays usable through a refresh. -->
              <FastestOverallNote
                v-if="fastestOverall"
                :fastest-overall="fastestOverall"
                class="pointer-events-auto"
                @show-all="setBikeCategory('all')"
                @include-halo="setIncludeHaloBikes(true)"
              />
            </template>
          </RideRecommendation>
          <section
            v-else
            aria-label="Recommended setup"
          >
            <p class="text-lg text-toned">
              No bikes match your filters.
              <template v-if="appliedRestrictions.search">
                Clear the search or widen the filters above the ranking to see it again.
              </template>
              <template v-else>
                Widen the filters above the ranking to see it again.
              </template>
            </p>
            <FastestOverallNote
              v-if="fastestOverall"
              :fastest-overall="fastestOverall"
              class="pointer-events-auto"
              @show-all="setBikeCategory('all')"
              @include-halo="setIncludeHaloBikes(true)"
            />
            <ul
              v-if="evidence.notes.length"
              class="mt-3 space-y-1 text-sm text-muted"
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
      </div>
      <slot name="rider" />
    </div>

    <!-- What the page has to say about the ranking beyond the ranking - a
         race's draft-mode hint - directly under the answer it qualifies,
         never between the course and the answer, which share the first
         screen on a phone. -->
    <slot name="page-block" />

    <!-- The answer the page's title asks for, in plain words, directly
         under the answer band - the words a crawler quotes are the words a
         rider reads first. Its Ride rules lead, where the Ride has any.
         Set as a caption, not a section of its own: it restates the answer
         band above it in a sentence, and at full size it read as the same
         answer given twice. -->
    <section
      v-if="answer"
      aria-labelledby="ride-answer-heading"
      class="mt-8 max-w-[72ch]"
    >
      <h2
        id="ride-answer-heading"
        class="text-md font-medium text-toned"
      >
        {{ faqQuestion }}
      </h2>
      <p class="mt-1 text-sm text-muted">
        {{ answer.summary }}
      </p>
      <p
        id="ride-answer-assumptions"
        class="mt-1 text-xs text-muted"
      >
        {{ answer.assumptions }}
      </p>
    </section>

    <div
      v-if="!isFirstLoad"
      class="mt-11 transition-opacity"
      :class="{ 'opacity-60': isRefreshing }"
    >
      <RideRanking
        v-model:search="bikeSearch"
        v-model:selected="comparisonKeys"
        :ranking="appliedRanking"
        :has-more="hasMore"
        :can-show-more="canShowMore"
        :applied-search="appliedRestrictions.search"
        :loading-more="loadingMore"
        :expansion-failed="expansionFailed"
        :hide-tt-category="hideTtCategory"
        @show-more="showMore"
      />
      <slot name="report-link" />
    </div>
  </div>
</template>
