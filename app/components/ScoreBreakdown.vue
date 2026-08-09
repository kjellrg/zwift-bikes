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
      color: 'bg-blue-500'
    },
    {
      key: 'climb',
      label: 'Climbing',
      value: props.breakdown.climb,
      color: 'bg-emerald-500'
    },
    {
      key: 'gravel',
      label: 'Gravel',
      value: props.breakdown.gravel,
      color: 'bg-amber-500'
    },
    {
      key: 'cobble',
      label: 'Cobbles',
      value: props.breakdown.cobble,
      color: 'bg-slate-500'
    }
  ].filter(s => s.value > 0)
)
</script>

<template>
  <div class="space-y-1.5 w-full">
    <div class="flex h-2 w-full overflow-hidden rounded-full bg-elevated">
      <div
        v-for="segment in segments"
        :key="segment.key"
        :class="segment.color"
        :style="{ width: `${segment.value}%` }"
      />
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      <span
        v-for="segment in segments"
        :key="segment.key"
        class="inline-flex items-center gap-1"
      >
        <span
          class="size-2 rounded-full inline-block"
          :class="segment.color"
        />
        {{ segment.label }}: {{ segment.value }}
      </span>
    </div>
  </div>
</template>
