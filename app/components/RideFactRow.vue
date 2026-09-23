<script setup lang="ts">
import type { SurfaceFamily } from '#shared/utils/silhouette'

/**
 * The Fact row (see `CONTEXT.md`): the plain-text numbers a rider chooses a
 * Ride by, under its heading - distance, elevation, climb ratio, surface
 * shares, climb count - and beneath them the Ride-only notes the page has
 * (a segment's timing and host routes, the lap and lead-in scope, the TTT
 * line). No badges: a number is bold ink, its label the secondary ink, and
 * a surface share carries its family's colour as a small swatch - the only
 * colour here, and the same one the hero's strip draws in.
 *
 * Ride-only by definition, so the page renders it from the Ride alone:
 * there with zero matches and during a refresh.
 */
defineProps<{
  facts: { value: string, label: string, family?: SurfaceFamily }[]
}>()
</script>

<template>
  <div class="mt-4 space-y-2 sm:mt-5 sm:space-y-3">
    <ul
      class="flex flex-wrap gap-x-6 gap-y-1.5 text-md text-toned"
      aria-label="Ride facts"
    >
      <li
        v-for="fact in facts"
        :key="fact.label"
        class="inline-flex items-baseline"
      >
        <span
          v-if="fact.family"
          class="mr-1.5 inline-block size-2.5 self-center rounded-[2px]"
          :class="SURFACE_FAMILY_BG[fact.family]"
          aria-hidden="true"
        />
        <span class="font-semibold text-highlighted">{{ fact.value }}</span>&nbsp;{{ fact.label }}
      </li>
    </ul>
    <ul
      v-if="$slots.default"
      class="max-w-[72ch] space-y-1 text-sm text-muted"
      aria-label="About this ride"
    >
      <slot />
    </ul>
  </div>
</template>
