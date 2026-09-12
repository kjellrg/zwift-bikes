<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'

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
  fastestOverall: {
    frameName: string
    category: BikeCategory
    reason: 'category' | 'halo'
    wheelsetName?: string
    deltaSec?: number
  }
}>()

defineEmits<{ showAll: [], includeHalo: [] }>()

const equipment = computed(() => props.fastestOverall.wheelsetName
  ? `${props.fastestOverall.frameName} with ${props.fastestOverall.wheelsetName}`
  : props.fastestOverall.frameName)

// Same shape as the TTT saving line (see `formatTttTimeSaving`): whole
// seconds under a minute, `m:ss` above it. Hundredths are noise at the scale
// this gap lives at, and it's a headline, not a ranking key.
const gapText = computed(() => {
  if (props.fastestOverall.deltaSec === undefined) return undefined
  const magnitude = Math.abs(props.fastestOverall.deltaSec)
  return magnitude < 60 ? `${Math.round(magnitude)}s` : formatDuration(magnitude)
})
</script>

<template>
  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-default bg-elevated/50 px-4 py-3 mb-6 text-sm">
    <UIcon
      name="i-lucide-zap"
      class="size-4 text-primary self-center"
    />
    <span>
      <span class="font-medium text-highlighted">Fastest overall:</span>
      {{ equipment }}
      <BikeCategoryBadge
        :category="fastestOverall.category"
        class="align-middle"
      />
      <template v-if="gapText">
        &mdash; {{ gapText }} quicker.
      </template>
      <template v-else>
        &mdash; not shown under your current filters.
      </template>
      <template v-if="fastestOverall.reason === 'halo'">A Halo bike - unlocking it takes three fully upgraded frames of one brand plus ~20 million Drops.</template>
      <template v-else-if="fastestOverall.category === 'tt'">TT bikes are restricted in many events.</template>
    </span>
    <ULink
      v-if="fastestOverall.reason === 'halo'"
      class="text-primary underline cursor-pointer"
      @click="$emit('includeHalo')"
    >Include Halo bikes</ULink>
    <ULink
      v-else
      class="text-primary underline cursor-pointer"
      @click="$emit('showAll')"
    >Show all categories</ULink>
  </div>
</template>
