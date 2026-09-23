<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'
import type { AppliedRanking } from '../utils/recommendRequest'
import { activeFiltersLabel } from '../utils/rankingResults'

/**
 * The Recommendation: rank 1 of the Ranking, shown as the page's answer.
 * The setup, its estimated finish time set large, the evidence lines that
 * say what the time rests on (bot-tested or not, the stage it was ranked
 * at, what rough surfaces or the draft did to it), and the paths deeper:
 * the Equipment drawer - the page's one primary button - the Garage, and
 * the Ranking it is rank 1 of.
 *
 * The controls that belong to a row - the comparison pick, the disclosure,
 * the Wheel alternatives - are on rank 1's row in the table, not repeated
 * here (see **Recommendation** in `CONTEXT.md`). The label claims "fastest
 * of every eligible setup" and names the filters that made the pool beside
 * it, rather than a count of setups the response does not carry.
 */
const props = defineProps<{
  combo: ComboScore
  /**
   * The Applied Ranking this setup is rank 1 of - the course and laps behind
   * the km/h, the filters the claim is made within, and what the Equipment
   * drawer is opened under.
   */
  ranking: AppliedRanking
  /** The one-line "limited route data" warning, when the course inputs are partial - see `limitedCourseDataNote`. */
  limitedDataNote?: string
  /** Evidence lines that qualify this time: the rough-surface cost, the paceline or bunch saving. */
  notes?: string[]
}>()

// The combo alone: everything else the drawer needs is the Applied Ranking,
// which it reads for itself - see `openBikeDetail`.
const { openBikeDetail } = useOverlays()

// Quick-adds start at the rider's chosen default stage for unowned bikes -
// the stage unowned bikes are ranked at everywhere else - so adding a bike
// never moves it in the ranking (see `GarageContent`).
const { owned, setOwned } = useGarage()
const { defaultUnownedLevel } = useRiderProfile()
const isOwned = computed(() => owned.value[props.combo.frame.id] !== undefined)
function toggleOwned() {
  setOwned(props.combo.frame.id, isOwned.value ? null : defaultUnownedLevel.value)
}

const laps = computed(() => props.ranking.ride?.laps)
const distanceKm = computed(() => props.ranking.course
  ? computeRouteTotals(props.ranking.course, laps.value ?? 1).distanceKm
  : undefined)
/** What the time covers, in a few words: the laps and the lead-in on a route, the timed stretch on a segment. */
const scope = computed(() => {
  if (laps.value === undefined) return 'the timed segment'
  const leadIn = (props.ranking.course?.leadInDistance ?? 0) > 0
  return `${laps.value} lap${laps.value === 1 ? '' : 's'}${leadIn ? ' with the lead-in' : ''}`
})
const botTested = computed(() => isBotTested(props.combo))
const stageLine = computed(() => {
  if (props.combo.frame.confidence !== 'measured') return undefined
  return isOwned.value
    ? `Ranked at your garage's upgrade stage ${props.combo.frame.level}`
    : `Ranked at upgrade stage ${props.combo.frame.level}, assumed for bikes you don't own`
})
const filters = computed(() => activeFiltersLabel(props.ranking.restrictions, props.ranking.rider.category))
</script>

<template>
  <section
    aria-labelledby="ride-recommendation-heading"
    class="min-w-0"
  >
    <p class="text-sm font-semibold text-primary">
      Fastest of every eligible setup
    </p>
    <p class="text-sm text-muted">
      {{ filters }}
    </p>
    <h2
      id="ride-recommendation-heading"
      class="mt-3 text-balance text-[clamp(1.625rem,3.4vw,2.25rem)] leading-tight font-semibold font-heading text-highlighted break-words"
    >
      <button
        type="button"
        class="text-left hover:underline decoration-rule-strong"
        :aria-label="`Details for ${combo.frame.name}`"
        @click="openBikeDetail(combo)"
      >
        {{ combo.frame.name }}
      </button>
    </h2>
    <p class="mt-1 text-lg text-toned break-words">
      {{ combo.wheelset ? `with ${combo.wheelset.name} wheels` : 'with its own fixed disc wheels' }}
    </p>
    <div class="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
      <p
        id="ride-finish-time"
        class="text-[clamp(4rem,9vw,6rem)] leading-[0.95] font-semibold font-timing tracking-[-0.01em] text-highlighted"
      >
        {{ combo.finishTimeSec !== undefined ? formatDuration(combo.finishTimeSec) : combo.score }}
      </p>
      <p class="text-md text-muted">
        <template v-if="combo.finishTimeSec !== undefined">
          <span
            v-if="distanceKm !== undefined"
            class="font-medium text-toned"
          >{{ formatSpeedKmh(distanceKm, combo.finishTimeSec) }} average</span>
          · estimated for {{ scope }}
        </template>
        <template v-else>
          match score
        </template>
      </p>
    </div>

    <ul class="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-toned">
      <li
        class="inline-flex items-center gap-1.5"
        :class="botTested ? 'text-success' : 'text-warning'"
      >
        <UIcon
          :name="botTested ? 'i-lucide-check' : 'i-lucide-circle-help'"
          class="size-4 shrink-0"
        />{{ botTested ? 'Frame and wheels bot-tested' : 'Includes estimated data' }}
      </li>
      <li v-if="stageLine">
        {{ stageLine }}
      </li>
      <li
        v-for="note in notes"
        :key="note"
      >
        {{ note }}
      </li>
      <li
        v-if="limitedDataNote"
        class="text-warning"
      >
        {{ limitedDataNote }}
      </li>
    </ul>

    <div class="mt-5 flex flex-wrap items-center gap-2.5">
      <UButton
        size="lg"
        @click="openBikeDetail(combo)"
      >
        Details &amp; upgrades
      </UButton>
      <UButton
        size="lg"
        color="neutral"
        variant="outline"
        :icon="isOwned ? 'i-lucide-check' : undefined"
        :aria-label="`${isOwned ? 'Remove' : 'Quick-add'} ${combo.frame.name} ${isOwned ? 'from' : 'to'} garage`"
        @click="toggleOwned"
      >
        {{ isOwned ? 'In your garage' : 'Add to garage' }}
      </UButton>
      <!-- The Recommendation is rank 1 of the table below, so the way to the
           rest of it is part of the answer. -->
      <a
        href="#ride-ranking"
        class="px-2 text-sm font-medium text-toned underline decoration-rule-strong hover:text-highlighted"
      >See the full ranking</a>
    </div>
    <!-- The notes that go deeper into the answer: a quicker setup the rules
         exclude, and the Climb trade. -->
    <slot name="notes" />
  </section>
</template>
