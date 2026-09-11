<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'

/**
 * The statistics a side-by-side comparison lines up per setup: where each
 * number comes from, the stage it was scored at, and the terrain match the
 * 0-100 score is made of. Presentation-only, straight off the `ComboScore`.
 */
defineProps<{ combo: ComboScore }>()
</script>

<template>
  <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
    <div>
      <dt class="text-muted">
        Frame data
      </dt><dd class="text-highlighted">
        {{ combo.frame.confidence === 'measured' ? 'Bot-tested' : 'Estimated' }}
      </dd>
    </div>
    <div>
      <dt class="text-muted">
        Wheel data
      </dt><dd class="text-highlighted">
        {{ combo.wheelset ? (combo.wheelset.confidence === 'measured' ? 'Bot-tested' : 'Estimated') : 'Fixed disc' }}
      </dd>
    </div>
    <!-- Only a measured frame has per-stage data, so only there is the stage a statistic. -->
    <div v-if="combo.frame.confidence === 'measured'">
      <dt class="text-muted">
        Upgrade stage
      </dt><dd class="text-highlighted tabular-nums">
        {{ combo.frame.level }} / 5
      </dd>
    </div>
    <div>
      <dt class="text-muted">
        Match score
      </dt><dd class="text-highlighted tabular-nums">
        {{ combo.score }} / 100
      </dd>
    </div>
    <div class="col-span-2">
      <dt class="sr-only">
        Terrain contributions
      </dt><dd><ScoreBreakdown :breakdown="combo.breakdown" /></dd>
    </div>
    <div v-if="combo.wheelOptions">
      <dt class="text-muted">
        Compatible wheels
      </dt><dd class="text-highlighted tabular-nums">
        {{ combo.wheelOptions }}
      </dd>
    </div>
    <div v-if="combo.surfaceTimePenaltySec !== undefined">
      <dt class="text-muted">
        Rough-surface cost
      </dt><dd class="text-highlighted tabular-nums">
        {{ combo.surfaceTimePenaltySec.toFixed(1) }}s
      </dd>
    </div>
  </dl>
</template>
