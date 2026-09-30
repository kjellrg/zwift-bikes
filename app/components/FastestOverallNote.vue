<script setup lang="ts">
import type { LeftOutSetup } from '../../shared/utils/recommendationAnswer'

/**
 * "A bike your filters are hiding is faster" - shown with the recommendation
 * whenever the category filter or the Halo filter is hiding the genuinely
 * quickest combo, and in place of it when those filters have left nothing to
 * rank at all (issue #221), which is where the reveal matters most.
 *
 * The pages default to the `standard` category (TT frames are restricted in
 * a lot of organised events) and to hiding the three purchasable Halo bikes
 * (each takes three fully upgraded frames of one brand plus ~20M Drops -
 * issue #112). Both are the right default for how the site is actually used,
 * but would otherwise be filters quietly withholding the real answer. This
 * line is what makes that trade honest: the fastest combo stays visible and
 * one click away - `reason` says which filter hid it, and picks which
 * one-click reveal the link offers.
 *
 * It renders from the recommend endpoints' `fastestOverall` field, which is
 * part of the server-rendered response - so this text is in the prerendered
 * HTML rather than appearing after hydration, and a crawler sees the frame
 * name and the gap too. On an empty ranking there is no rank 1 to measure
 * against, so `deltaSec` is absent and the line says the bike is out of view
 * instead of how much quicker it is, and the row shows no time.
 *
 * Drawn as a result row (issue #300) rather than a note with a left rule:
 * the setup is an answer to a different question, with its own time.
 */
const props = defineProps<{
  fastestOverall: LeftOutSetup
  /** Rank 1's finish time, which the hidden setup's own time is measured from; absent when there is no rank 1. */
  rankOneTimeSec?: number
}>()

defineEmits<{ showAll: [], includeHalo: [] }>()

const equipment = computed(() => namedSetup(props.fastestOverall.frameName, props.fastestOverall.wheelsetName))

/** The condition the row answers, in the rider's words. */
const lead = computed(() => props.fastestOverall.reason === 'halo'
  ? 'If Halo bikes are allowed'
  : props.fastestOverall.category === 'tt' ? 'If time-trial frames are allowed' : 'If other categories are allowed')

// The gap reads exactly as the answer's own clause about this setup says it
// (`buildRecommendationAnswer`), from the same formatter, so the row and the
// sentence a crawler quotes cannot give two numbers for one fact. That
// formatter keeps a decimal under ten seconds and never rounds a real gap to
// nothing, which the whole-second form used here before did ("0s quicker").
const gapText = computed(() => props.fastestOverall.deltaSec === undefined
  ? undefined
  : formatGapSeconds(props.fastestOverall.deltaSec))

/** The hidden setup's own time: rank 1's less how much quicker it is. Absent when either is. */
const timeText = computed(() => props.rankOneTimeSec === undefined || props.fastestOverall.deltaSec === undefined
  ? undefined
  : formatDuration(props.rankOneTimeSec - props.fastestOverall.deltaSec))
</script>

<template>
  <!-- A second, smaller result: the setup the filters withhold, as a row
       with its own time, and the one action that puts it on screen. -->
  <div
    role="group"
    aria-label="Quicker setup your filters hide"
    class="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-default pt-4"
  >
    <div class="min-w-0 flex-1 basis-56">
      <p class="text-xs font-semibold text-muted">
        {{ lead }}
      </p>
      <p class="mt-0.5 font-semibold text-highlighted break-words">
        {{ equipment }} <span class="font-normal text-muted">({{ BIKE_CATEGORY_LABELS[fastestOverall.category] }})</span>
      </p>
      <p
        v-if="!timeText"
        class="text-sm text-toned"
      >
        The {{ equipment }} is not shown under your current filters.
      </p>
      <p
        v-if="fastestOverall.reason === 'halo'"
        class="text-sm text-muted"
      >
        A Halo bike · unlocking it takes three fully upgraded frames of one brand plus ~20 million Drops.
      </p>
      <p
        v-else-if="fastestOverall.category === 'tt'"
        class="text-sm text-muted"
      >
        TT frames are barred in many races.
      </p>
    </div>
    <div
      v-if="timeText"
      class="text-right"
    >
      <p class="text-2xl leading-none font-semibold font-timing text-highlighted">
        {{ timeText }}
      </p>
      <p class="mt-1 text-sm text-muted">
        {{ gapText }} faster
      </p>
    </div>
    <UButton
      v-if="fastestOverall.reason === 'halo'"
      size="sm"
      color="neutral"
      variant="outline"
      @click="$emit('includeHalo')"
    >
      Include Halo bikes
    </UButton>
    <UButton
      v-else
      size="sm"
      color="neutral"
      variant="outline"
      @click="$emit('showAll')"
    >
      {{ fastestOverall.category === 'tt' ? 'Include TT frames' : 'Show all categories' }}
    </UButton>
  </div>
</template>
