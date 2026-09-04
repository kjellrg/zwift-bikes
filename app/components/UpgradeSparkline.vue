<script setup lang="ts">
/**
 * One measured frame's gain from upgrading, stage 0 to 5, as a sparkline:
 * what each stage is worth over the just-bought bike. The stage the bike is
 * currently scored at is the filled point. Drawn relative to stage 0 rather
 * than to the reference bike because the question the drawer answers here is
 * "what does upgrading do", not "how does this bike compare".
 *
 * Used for both kinds of answer, which differ only in their `unit`: the two
 * ZwiftInsider bot tests in seconds per hour, and the rider's own route in
 * seconds off this ride (`ComboScore.upgradeFinishTimesSec`).
 */
const props = defineProps<{
  /** Six values, stage 0 to 5, seconds per hour against the reference bike (`UpgradeCurve.flat` or `.climb`). */
  values: readonly number[]
  /** The stage to mark. */
  level: number
  label: string
  /**
   * What one unit of `values` is. The bot-test curves are seconds per hour;
   * a route curve is seconds off that one ride, which is a smaller number and
   * a more useful one - see `ComboScore.upgradeFinishTimesSec`.
   */
  unit?: string
  /**
   * Set on a chart that spans the drawer's full width rather than sharing a
   * two-column row.
   *
   * The SVG scales to its container, so the same viewBox in twice the width
   * draws everything at twice the size - line, dots, height and all - and the
   * wide chart shouted next to the pair below it. The fix is the viewBox and
   * nothing else: exactly twice as wide, for exactly twice the rendered
   * width, which leaves the scale identical and therefore every mark the same
   * size as on the two charts below. The chart gets its extra width by
   * spreading six stages over more room, which is the point of giving it the
   * room.
   */
  wide?: boolean
}>()

const unit = computed(() => props.unit ?? 's/h')

const VIEW_HEIGHT = 40
const PAD_X = 6
const PAD_Y = 5
const DOT_R = 1.75
const ACTIVE_DOT_R = 3.5

// The only thing a full-width chart changes: twice the user units for twice
// the rendered width, so one unit stays one pixel either way.
const viewWidth = computed(() => (props.wide ? 264 : 132))

const gains = computed(() => props.values.map(value => value - (props.values[0] ?? 0)))

const points = computed(() => {
  const min = Math.min(0, ...gains.value)
  const max = Math.max(1, ...gains.value)
  const stepX = (viewWidth.value - PAD_X * 2) / Math.max(1, gains.value.length - 1)
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
const summary = computed(() => `${props.label}: ${gains.value.map((gain, stage) => `stage ${stage} ${signed(gain)} ${unit.value}`).join(', ')}`)
</script>

<template>
  <div class="space-y-1">
    <div class="flex items-baseline justify-between gap-2 text-xs">
      <span class="font-medium text-highlighted">{{ label }}</span>
      <span class="text-muted tabular-nums">
        now <span class="font-semibold text-primary">{{ signed(current?.gain ?? 0) }}</span>
        · maxed {{ signed(maxed) }} {{ unit }}
      </span>
    </div>
    <svg
      :viewBox="`0 0 ${viewWidth} ${VIEW_HEIGHT}`"
      class="w-full h-auto"
      role="img"
      :aria-label="summary"
    >
      <title>{{ summary }}</title>
      <line
        :x1="PAD_X"
        :x2="viewWidth - PAD_X"
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
        :r="point.stage === current?.stage ? ACTIVE_DOT_R : DOT_R"
        fill="currentColor"
        :class="point.stage === current?.stage ? 'text-primary' : 'text-muted'"
      >
        <title>Stage {{ point.stage }}: {{ signed(point.gain) }} {{ unit }}</title>
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
