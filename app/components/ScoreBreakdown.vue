<script setup lang="ts">
import type { ComboScoreBreakdown } from '../../shared/types/catalog'

const props = defineProps<{
  breakdown: ComboScoreBreakdown
}>()

const segments = computed(() =>
  [
    {
      key: 'aero',
      label: 'Aero (flat/fast)',
      value: props.breakdown.aero,
      color: 'bg-ink'
    },
    {
      key: 'climb',
      label: 'Climbing',
      value: props.breakdown.climb,
      color: 'bg-ink-toned'
    },
    {
      key: 'gravel',
      label: 'Gravel',
      value: props.breakdown.gravel,
      color: 'bg-dirt'
    },
    {
      key: 'cobble',
      label: 'Cobbles',
      value: props.breakdown.cobble,
      color: 'bg-rough'
    }
  ].filter(s => s.value > 0)
)
</script>

<template>
  <div class="space-y-1.5 w-full">
    <div class="flex h-2 w-full gap-0.5 overflow-hidden rounded-[3px] bg-accented">
      <div
        v-for="segment in segments"
        :key="segment.key"
        :class="segment.color"
        :style="{ width: `${segment.value}%` }"
      />
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-toned">
      <span
        v-for="segment in segments"
        :key="segment.key"
        class="inline-flex items-center gap-1"
      >
        <span
          class="inline-block size-2.5 rounded-[2px]"
          :class="segment.color"
        />
        {{ segment.label }}: {{ segment.value }}
      </span>
    </div>
  </div>
</template>
