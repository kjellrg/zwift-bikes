<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'

/**
 * Up to three picked setups side by side: time, gap to the fastest on the
 * page, and the per-setup statistics. Renders nothing until something is
 * picked, and lives in the page's flow (not a floating panel) so it reads
 * with the list it was picked from and never covers it on a phone.
 */
defineProps<{
  /** The picked combos, in pick order. */
  combos: ComboScore[]
  fastestTimeSec?: number
}>()

defineEmits<{ clear: [], remove: [key: string] }>()
</script>

<template>
  <section
    v-if="combos.length"
    id="ride-comparison"
    aria-labelledby="ride-comparison-heading"
    aria-live="polite"
    class="scroll-mt-24 border-t-2 border-primary pt-6"
  >
    <div class="flex items-center justify-between gap-4">
      <h2
        id="ride-comparison-heading"
        class="text-xl font-semibold text-highlighted"
      >
        Selected setups <span class="text-sm font-normal text-muted">{{ combos.length }} / {{ COMPARISON_LIMIT }}</span>
      </h2>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="outline"
        size="sm"
        aria-label="Clear comparison"
        @click="$emit('clear')"
      />
    </div>
    <div class="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
      <article
        v-for="combo in combos"
        :key="comboKey(combo)"
        class="min-w-0 space-y-3 rounded-lg border border-default p-4"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h3 class="font-semibold text-highlighted break-words">
              {{ combo.frame.name }}
            </h3>
            <p class="text-sm text-muted break-words">
              {{ combo.wheelset?.name ?? 'Fixed disc wheels (not swappable)' }}
            </p>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Remove ${combo.frame.name} from comparison`"
            @click="$emit('remove', comboKey(combo))"
          />
        </div>
        <template v-if="combo.finishTimeSec !== undefined">
          <p class="text-3xl font-bold tabular-nums text-highlighted">
            {{ formatDuration(combo.finishTimeSec) }}
          </p>
          <p class="text-sm text-primary">
            {{ fastestTimeSec === undefined ? '' : formatDurationGap(combo.finishTimeSec - fastestTimeSec, 'Fastest in results') }}
          </p>
        </template>
        <ComboCompareStats :combo="combo" />
      </article>
    </div>
  </section>
</template>
