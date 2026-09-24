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
 * instead of how much quicker it is.
 */
const props = defineProps<{
  fastestOverall: LeftOutSetup
}>()

defineEmits<{ showAll: [], includeHalo: [] }>()

const equipment = computed(() => namedSetup(props.fastestOverall.frameName, props.fastestOverall.wheelsetName))

/** The question the note answers, in the rider's words. */
const lead = computed(() => props.fastestOverall.reason === 'halo'
  ? 'Halo bikes allowed?'
  : props.fastestOverall.category === 'tt' ? 'Time-trial bikes allowed?' : 'Other categories allowed?')

// The gap reads exactly as the answer's own clause about this setup says it
// (`buildRecommendationAnswer`), from the same formatter, so the note and the
// sentence a crawler quotes cannot give two numbers for one fact. That
// formatter keeps a decimal under ten seconds and never rounds a real gap to
// nothing, which the whole-second form used here before did ("0s quicker").
const gapText = computed(() => props.fastestOverall.deltaSec === undefined
  ? undefined
  : formatGapSeconds(props.fastestOverall.deltaSec))
</script>

<template>
  <!-- A note, not an alert: it explains what the filters withheld, and the
       one action puts it on screen. -->
  <p class="mt-5 border-l-2 border-accented py-2 pl-3.5 text-sm text-toned">
    <span class="font-semibold text-highlighted">{{ lead }}</span>
    The {{ equipment }} ({{ BIKE_CATEGORY_LABELS[fastestOverall.category] }})
    <template v-if="gapText">
      is {{ gapText }} quicker.
    </template>
    <template v-else>
      is not shown under your current filters.
    </template>
    <template v-if="fastestOverall.reason === 'halo'">
      A Halo bike - unlocking it takes three fully upgraded frames of one brand plus ~20 million Drops.
    </template>
    <template v-else-if="fastestOverall.category === 'tt'">
      TT frames are barred in many races.
    </template>
    <button
      v-if="fastestOverall.reason === 'halo'"
      type="button"
      class="ml-1 font-medium text-primary hover:underline"
      @click="$emit('includeHalo')"
    >
      Include Halo bikes
    </button>
    <button
      v-else
      type="button"
      class="ml-1 font-medium text-primary hover:underline"
      @click="$emit('showAll')"
    >
      {{ fastestOverall.category === 'tt' ? 'Include TT frames' : 'Show all categories' }}
    </button>
  </p>
</template>
