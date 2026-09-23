<script setup lang="ts">
import type { UpgradeCurve } from '../../shared/types/catalog'
import { toUpgradeStage } from '#shared/utils/upgradeStage'

/**
 * A measured frame's upgrade curve in a Ranking row: what each stage from 0
 * to 5 is worth over the stock frame on ZwiftInsider's flat and climb bot
 * tests, as two lines in the neutral ink - solid for flat, dashed for climb -
 * with the stage the row is ranked at marked. Drawn against stage 0, because
 * the question a row answers here is "what does upgrading do", not "how does
 * this frame compare"; the Equipment drawer has the per-route curve.
 */
const props = defineProps<{
  curve: UpgradeCurve
  /** The stage the row is ranked at. */
  level: number
}>()

const VIEW_WIDTH = 240
const VIEW_HEIGHT = 64
const PAD = 6

const series = computed(() => {
  const gains = {
    flat: props.curve.flat.map(value => value - (props.curve.flat[0] ?? 0)),
    climb: props.curve.climb.map(value => value - (props.curve.climb[0] ?? 0))
  }
  const all = [...gains.flat, ...gains.climb]
  const min = Math.min(0, ...all)
  const max = Math.max(1, ...all)
  const x = (stage: number) => PAD + (stage / 5) * (VIEW_WIDTH - PAD * 2)
  const y = (gain: number) => VIEW_HEIGHT - PAD - ((gain - min) / (max - min)) * (VIEW_HEIGHT - PAD * 2)
  const line = (values: number[]) => values.map((gain, stage) => `${x(stage).toFixed(1)},${y(gain).toFixed(1)}`).join(' ')
  const stage = toUpgradeStage(props.level)
  return {
    flat: line(gains.flat),
    climb: line(gains.climb),
    marker: { x: x(stage), flatY: y(gains.flat[stage] ?? 0), climbY: y(gains.climb[stage] ?? 0) },
    summary: `Upgrade gains over stage 0, seconds per hour: flat ${gains.flat.map(gain => gain.toFixed(0)).join(', ')}; climb ${gains.climb.map(gain => gain.toFixed(0)).join(', ')}. Ranked at stage ${stage}.`,
    maxed: { flat: gains.flat.at(-1) ?? 0, climb: gains.climb.at(-1) ?? 0 }
  }
})
</script>

<template>
  <div>
    <svg
      :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
      class="block h-16 w-full"
      role="img"
      :aria-label="series.summary"
    >
      <polyline
        :points="series.climb"
        fill="none"
        class="stroke-ink-muted"
        stroke-width="1.5"
        stroke-dasharray="4 3"
      />
      <polyline
        :points="series.flat"
        fill="none"
        class="stroke-ink"
        stroke-width="1.75"
      />
      <line
        :x1="series.marker.x"
        :x2="series.marker.x"
        :y1="PAD"
        :y2="VIEW_HEIGHT - PAD"
        class="stroke-rule-strong"
      />
      <circle
        :cx="series.marker.x"
        :cy="series.marker.flatY"
        r="3"
        class="fill-ink"
      />
    </svg>
    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <span class="inline-flex items-center gap-1.5"><span
        class="inline-block h-0.5 w-4 bg-ink"
        aria-hidden="true"
      />Flat, +{{ series.maxed.flat.toFixed(0) }} s/h at stage 5</span>
      <span class="inline-flex items-center gap-1.5"><span
        class="inline-block h-0 w-4 border-t-2 border-dashed border-muted"
        aria-hidden="true"
      />Climb, +{{ series.maxed.climb.toFixed(0) }} s/h</span>
    </div>
  </div>
</template>
