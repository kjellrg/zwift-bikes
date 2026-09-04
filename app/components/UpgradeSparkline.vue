<script setup lang="ts">
/**
 * One measured frame's gain from upgrading, stage 0 to 5, as a sparkline:
 * seconds saved per hour over the just-bought bike, on one of the two
 * ZwiftInsider bot tests. The stage the bike is currently scored at is the
 * filled point. Drawn relative to stage 0 rather than to the reference bike
 * because the question the drawer answers here is "what does upgrading
 * do", not "how does this bike compare".
 */
const props = defineProps<{
  /** Six values, stage 0 to 5, seconds per hour against the reference bike (`UpgradeCurve.flat` or `.climb`). */
  values: readonly number[]
  /** The stage to mark. */
  level: number
  label: string
}>()

const VIEW_WIDTH = 132
const VIEW_HEIGHT = 40
const PAD_X = 6
const PAD_Y = 5

const gains = computed(() => props.values.map(value => value - (props.values[0] ?? 0)))

const points = computed(() => {
  const min = Math.min(0, ...gains.value)
  const max = Math.max(1, ...gains.value)
  const stepX = (VIEW_WIDTH - PAD_X * 2) / Math.max(1, gains.value.length - 1)
  return gains.value.map((gain, stage) => ({
    stage,
    gain,
    x: PAD_X + stage * stepX,
    y: VIEW_HEIGHT - PAD_Y - ((gain - min) / (max - min)) * (VIEW_HEIGHT - PAD_Y * 2)
  }))
})

const polyline = computed(() => points.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const current = computed(() => points.value[Math.min(5, Math.max(0, Math.round(props.level)))])
const maxed = computed(() => gains.value[gains.value.length - 1] ?? 0)

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
const summary = computed(() => `${props.label}: ${gains.value.map((gain, stage) => `stage ${stage} ${signed(gain)} s/h`).join(', ')}`)
</script>

<template>
  <div class="space-y-1">
    <div class="flex items-baseline justify-between gap-2 text-xs">
      <span class="font-medium text-highlighted">{{ label }}</span>
      <span class="text-muted tabular-nums">
        now <span class="font-semibold text-primary">{{ signed(current?.gain ?? 0) }}</span>
        · maxed {{ signed(maxed) }} s/h
      </span>
    </div>
    <svg
      :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
      class="w-full h-auto"
      role="img"
      :aria-label="summary"
    >
      <title>{{ summary }}</title>
      <line
        :x1="PAD_X"
        :x2="VIEW_WIDTH - PAD_X"
        :y1="points[0]?.y"
        :y2="points[0]?.y"
        stroke="currentColor"
        class="text-muted"
        stroke-width="1"
        stroke-dasharray="1 3"
        opacity="0.6"
      />
      <polyline
        :points="polyline"
        fill="none"
        stroke="currentColor"
        class="text-primary"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle
        v-for="point in points"
        :key="point.stage"
        :cx="point.x"
        :cy="point.y"
        :r="point.stage === current?.stage ? 3.5 : 1.75"
        fill="currentColor"
        :class="point.stage === current?.stage ? 'text-primary' : 'text-muted'"
      >
        <title>Stage {{ point.stage }}: {{ signed(point.gain) }} s/h</title>
      </circle>
    </svg>
    <div class="flex justify-between text-[10px] text-muted tabular-nums">
      <span
        v-for="point in points"
        :key="point.stage"
        :class="point.stage === current?.stage ? 'font-semibold text-primary' : ''"
      >{{ point.stage }}</span>
    </div>
  </div>
</template>
