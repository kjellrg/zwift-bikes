<script setup lang="ts">
import type { RideFact, SurfaceSplit } from '../utils/rideFacts'

/**
 * The spec row (see **Fact row** in `CONTEXT.md`): the numbers a rider
 * chooses a Ride by, under its heading, as cells split by hairlines - the
 * value above a small label - and across the full width a Surface cell: a
 * stacked bar of tarmac, dirt and rough in the hero strip's own colours with
 * its key, or "All tarmac" with no bar. Beneath it, the Ride-only notes the
 * page has (a segment's timing and host routes, the TTT line). No badges.
 *
 * Ride-only by definition, so the page renders it from the Ride alone:
 * there with zero matches and during a refresh. A list, so the facts are
 * read as one and the first cell is always the distance.
 */
defineProps<{
  facts: RideFact[]
  /** The Ride's surface mix; absent when the ride has none. */
  surface?: SurfaceSplit
}>()
</script>

<template>
  <div class="mt-4 space-y-3 sm:mt-5">
    <div class="overflow-hidden rounded-lg border border-default">
      <ul
        class="-mr-px -mb-px grid grid-cols-2 sm:flex sm:flex-wrap"
        aria-label="Ride facts"
      >
        <li
          v-for="fact in facts"
          :key="fact.label"
          class="min-w-0 border-r border-b border-default px-4 py-2.5 sm:flex-1 sm:basis-36"
        >
          <span class="block text-xl leading-tight font-bold font-display whitespace-nowrap text-highlighted">{{ fact.value }}</span>
          <span class="block text-xs text-muted">{{ fact.label }}</span>
        </li>
        <li
          v-if="surface"
          class="col-span-2 border-r border-b border-default px-4 py-2.5 sm:basis-full"
        >
          <span
            v-if="surface.allTarmac"
            class="block text-xl leading-tight font-bold font-display text-highlighted"
          >All tarmac</span>
          <template v-else>
            <span
              class="mt-0.5 flex h-2 overflow-hidden rounded-full"
              aria-hidden="true"
            >
              <span
                v-for="part in surface.parts"
                :key="part.family"
                :class="SURFACE_FAMILY_BG[part.family]"
                :style="{ width: `${part.percent}%` }"
              />
            </span>
            <span class="mt-1.5 flex flex-wrap gap-x-4 text-sm text-toned">
              <span
                v-for="entry in surface.key"
                :key="entry.family"
                class="inline-flex items-center"
              >
                <span
                  class="mr-1.5 inline-block size-2.5 rounded-[2px]"
                  :class="SURFACE_FAMILY_BG[entry.family]"
                  aria-hidden="true"
                />{{ entry.text }}
              </span>
            </span>
          </template>
          <span class="mt-1 block text-xs text-muted">Surface</span>
        </li>
      </ul>
    </div>
    <ul
      v-if="$slots.default"
      class="max-w-[72ch] space-y-1 text-sm text-muted"
      aria-label="About this ride"
    >
      <slot />
    </ul>
  </div>
</template>
