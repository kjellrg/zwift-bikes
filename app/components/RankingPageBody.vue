<script setup lang="ts">
import type { RankingPage } from '../composables/useRankingPage'

/**
 * Everything a Ranking page (see `CONTEXT.md`) shows beneath its own header,
 * in the same order on every one: the recommend data notice and the results
 * announcement, the Ranking results, "Why this bike wins here" beside the
 * course analysis, the comparison and the physics note.
 *
 * Handed the page's `useRankingPage` result whole and nothing else, so a new
 * Ranking results feature lands here once rather than on three pages. What a
 * page adds comes in through slots, never a page-kind prop:
 *
 * - `#rider` - the page's own Rider card, given the Applied values every
 *   page's card shows (`rider`, `refreshing`, `hasLongClimb`, `appliedLaps`)
 *   and the levers the Race format fixes, with the reason (`ttBarred`,
 *   `draftLocked`), so the page adds only what is its own;
 * - `#report-link` - the page's report link, given the report line;
 * - `#page-block` - a block above the answer band (the Race format's draft nudge);
 * - `#scoring` - the course analysis's Scoring tab, whose presence adds it;
 * - `#related` - what the page links on to, between the comparison and the
 *   physics note.
 *
 * The slots handed on to `RideResults` and the course analysis are handed on
 * only when the page fills them, so they behave there exactly as if the page
 * had filled them itself.
 *
 * A fragment on purpose, like `RideResults`: its parts are siblings of the
 * page's own sections, each at its own spacing step, and a wrapper would put
 * the whole body at one.
 */
const props = defineProps<{
  page: RankingPage
}>()

// Destructured once, for the template: a plain object's nested refs do not
// auto-unwrap there, and setup-returned ones do. Safe because a page creates
// exactly one `useRankingPage`, whose object identity never changes.
const {
  request, comparison, answer, faqQuestion, hideTtCategory, rules,
  why, courseAnalysis, hasLongClimb, appliedLaps, reportLine
} = props.page
const { resultsAnnouncement, appliedInputs, isRefreshing, physics, fastestTimeSec } = request
const { picked: comparedCombos, clear: clearComparison, remove: removeFromComparison } = comparison
</script>

<template>
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
    :hide-tt-category="hideTtCategory"
  >
    <template
      v-if="$slots['page-block']"
      #page-block
    >
      <slot name="page-block" />
    </template>

    <template
      v-if="$slots.rider"
      #rider
    >
      <slot
        name="rider"
        :rider="appliedInputs"
        :refreshing="isRefreshing"
        :has-long-climb="hasLongClimb"
        :applied-laps="appliedLaps"
        :tt-barred="rules?.ttBarredReason"
        :draft-locked="rules?.draftLockedReason"
      />
    </template>

    <template
      v-if="$slots['report-link']"
      #report-link
    >
      <slot
        name="report-link"
        :report-line="reportLine"
      />
    </template>
  </RideResults>

  <div class="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-2">
    <RideWhy
      :course="why.course"
      :combo="why.combo"
      :ride-name="why.rideName"
      :physics-mode="why.physicsMode"
      :draft-mode="why.draftMode"
      :wheel-choice="why.wheelChoice"
      :refreshing="why.refreshing"
    />
    <RideCourseAnalysis
      v-if="courseAnalysis"
      :route="courseAnalysis.route"
      :results-route="courseAnalysis.resultsRoute"
      :kind="courseAnalysis.kind"
      :laps="courseAnalysis.laps"
      :results-laps="courseAnalysis.resultsLaps"
      :combo="courseAnalysis.combo"
      :rider="courseAnalysis.rider"
      :refreshing="courseAnalysis.refreshing"
      :loading="courseAnalysis.loading"
      :plan="courseAnalysis.plan"
      :scoring="Boolean($slots.scoring)"
    >
      <template
        v-if="$slots.scoring"
        #scoring
      >
        <slot name="scoring" />
      </template>
    </RideCourseAnalysis>
  </div>

  <RideComparison
    class="mt-16"
    :combos="comparedCombos"
    :fastest-time-sec="fastestTimeSec"
    @clear="clearComparison"
    @remove="removeFromComparison"
  />

  <slot name="related" />

  <PhysicsNote
    v-if="physics"
    class="mt-12"
    :mode="physics.mode"
    :summary="physics.summary"
    :note="physics.note"
  />
</template>
