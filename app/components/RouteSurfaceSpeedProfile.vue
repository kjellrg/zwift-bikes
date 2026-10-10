<script setup lang="ts">
import type { RouteSurfaceSpeedProfile } from '../../shared/utils/physics/routeSurfaceSpeedProfile'

/**
 * The speed chart: a renderer of one setup's speed profile on the Ride,
 * handed to it whole. It runs no simulation of its own - the course analysis
 * asks the Applied Ride for the profile once, the first time a rider opens a
 * tab that reads it, and the Surfaces tab's extra watts come off the same
 * profile, so one render costs one simulation.
 */
const props = defineProps<{
  /** The profile to draw; absent until it has been asked for. */
  profile?: RouteSurfaceSpeedProfile
  /** Whether the profile is being worked out - a spinner stands in for the chart meanwhile. */
  computing?: boolean
}>()

const VIEW_WIDTH = 800
const PAD_LEFT = 56
const PAD_RIGHT = 12
const PAD_TOP = 10
const PAD_BOTTOM = 20
const CURVE_HEIGHT = 100
/** Gap between the smoothed speed curve and the surface strip below it - `0` so the curve's area
 * fill sits directly on top of the strip, reading as one continuous shape rather than two pieces
 * with a stray band of empty space between them. */
const STRIP_GAP = 0
const STRIP_HEIGHT = 12
const VIEW_HEIGHT = PAD_TOP + CURVE_HEIGHT + STRIP_GAP + STRIP_HEIGHT + PAD_BOTTOM
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT
/** Fraction of headroom above the fastest segment, so the curve's peak doesn't touch the top edge. */
const Y_HEADROOM_FRACTION = 0.12
const BASELINE_Y = PAD_TOP + CURVE_HEIGHT
const STRIP_Y = BASELINE_Y + STRIP_GAP
/** A "biggest surface penalty" callout is only shown for segments at least this long - very short real
 * surface segments (a few metres of dirt where a path crosses the road) produce a real but practically
 * meaningless wattage spike that isn't worth calling out as "the" penalty for the route. */
const MIN_PENALTY_SEGMENT_KM = 0.2

const profile = computed(() => props.profile)
const segments = computed(() => profile.value?.segments)
const speedSamples = computed(() => profile.value?.speedSamples)

const totalDistanceM = computed(() => (segments.value?.at(-1)?.toKm ?? 0) * 1000)
const soloComparison = computed(() => profile.value?.soloComparison)
// Both the curve's knots and its y-axis range come from the fine-grained `speedSamples`, not the
// coarser per-surface-segment `segments` - a real climb/descent inside a long uniform-surface stretch
// only shows up at that finer resolution (see `RouteSurfaceSpeedProfile`'s own doc comment). The TTT
// solo-comparison series folds into the same range, or its (slower) dashed line would clip below the
// chart's zoomed-in floor.
const allSpeedSamples = computed(() => [...(speedSamples.value ?? []), ...(soloComparison.value?.speedSamples ?? [])])
const maxSpeedKmh = computed(() => allSpeedSamples.value.reduce((max, s) => Math.max(max, s.avgSpeedKmh), 0))
const minSpeedKmh = computed(() => allSpeedSamples.value.length ? allSpeedSamples.value.reduce((min, s) => Math.min(min, s.avgSpeedKmh), Infinity) : 0)
/** Minimum visible speed span (km/h) the curve is allowed to zoom into - without a floor, a route with
 * almost no speed variation (e.g. flat, all-tarmac) would stretch a trivial ±1 km/h wobble to fill the
 * whole chart height, reading as far more dramatic than it really is. */
const MIN_SPEED_RANGE_KMH = 8
const speedRange = computed(() => Math.max(MIN_SPEED_RANGE_KMH, maxSpeedKmh.value - minSpeedKmh.value))

function scaleX(distanceM: number) {
  if (totalDistanceM.value === 0) return PAD_LEFT
  return PAD_LEFT + (distanceM / totalDistanceM.value) * PLOT_WIDTH
}
/** Zooms into the route's own [min, max] speed range (headroom above the peak only) rather than anchoring to an absolute 0 km/h baseline - anchoring to
 * zero wasted most of the chart's height on speeds well below anything a route ever produces, which
 * compressed the real, physically-accurate variation between segments into a thin sliver and made the
 * curve read as far flatter/subtler than the underlying simulation actually is. */
function scaleYSpeed(speedKmh: number) {
  const paddedRange = speedRange.value * (1 + Y_HEADROOM_FRACTION)
  if (paddedRange <= 0) return BASELINE_Y
  return PAD_TOP + CURVE_HEIGHT - ((speedKmh - minSpeedKmh.value) / paddedRange) * CURVE_HEIGHT
}

interface CurveSegment {
  x0: number
  y0: number
  cp1x: number
  cp1y: number
  cp2x: number
  cp2y: number
  x1: number
  y1: number
}

/**
 * Monotone cubic Hermite interpolation (Fritsch-Carlson) between already pixel-scaled points, kept local rather
 * than shared since it's a small, self-contained piece of SVG path math with no other dependents.
 * Turns the underlying step data (one average speed per real surface segment) into a smoothly-varying
 * curve instead of a bar chart with sudden vertical jumps at every segment boundary - the surface
 * strip below the curve still marks the real segment boundaries precisely, so no positional accuracy
 * is lost, only the height transition between segments is visually eased.
 */
function monotoneCubicSegments(pts: { x: number, y: number }[]): CurveSegment[] {
  const n = pts.length
  if (n < 2) return []

  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1]!.x - pts[i]!.x
    dx.push(h)
    slope.push(h === 0 ? 0 : (pts[i + 1]!.y - pts[i]!.y) / h)
  }

  const tangent: number[] = new Array(n).fill(0)
  tangent[0] = slope[0] ?? 0
  tangent[n - 1] = slope[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1]!
    const s1 = slope[i]!
    tangent[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    const s = slope[i]!
    if (s === 0) {
      tangent[i] = 0
      tangent[i + 1] = 0
      continue
    }
    const a = tangent[i]! / s
    const b = tangent[i + 1]! / s
    const sumSq = a * a + b * b
    if (sumSq > 9) {
      const tau = 3 / Math.sqrt(sumSq)
      tangent[i] = tau * a * s
      tangent[i + 1] = tau * b * s
    }
  }

  return dx.map((h, i) => {
    const p0 = pts[i]!
    const p1 = pts[i + 1]!
    return {
      x0: p0.x,
      y0: p0.y,
      cp1x: p0.x + h / 3,
      cp1y: p0.y + (tangent[i]! * h) / 3,
      cp2x: p1.x - h / 3,
      cp2y: p1.y - (tangent[i + 1]! * h) / 3,
      x1: p1.x,
      y1: p1.y
    }
  })
}

// Sourced from `profile.elevationPoints` - the resolved Ride's own geometry, the one the speed curve
// was simulated over - so the backdrop and the curve cannot drift apart along the ride.
const elevationPoints = computed(() => profile.value?.elevationPoints ?? [])

const MIN_ELEVATION_RANGE_M = 50
const elevationMin = computed(() => elevationPoints.value.reduce((min, p) => Math.min(min, p.elevationM), elevationPoints.value[0]?.elevationM ?? 0))
const elevationMax = computed(() => elevationPoints.value.reduce((max, p) => Math.max(max, p.elevationM), elevationPoints.value[0]?.elevationM ?? 0))
const elevationRange = computed(() => Math.max(MIN_ELEVATION_RANGE_M, elevationMax.value - elevationMin.value))

function scaleYElevation(elevationM: number) {
  const paddedRange = elevationRange.value * (1 + Y_HEADROOM_FRACTION)
  if (paddedRange <= 0) return BASELINE_Y
  return PAD_TOP + CURVE_HEIGHT - ((elevationM - elevationMin.value) / paddedRange) * CURVE_HEIGHT
}

/** A very subtle, single-tone elevation silhouette drawn behind the speed curve - purely a visual
 * reference so a dip in the speed curve can be read against the climb that caused it, in the muted
 * ink at low opacity, since here it's backdrop, not the subject. */
const elevationAreaPath = computed(() => {
  const segs = monotoneCubicSegments(elevationPoints.value.map(p => ({ x: scaleX(p.distanceM), y: scaleYElevation(p.elevationM) })))
  if (!segs.length) return ''
  const first = segs[0]!
  const last = segs[segs.length - 1]!
  const top = `M${first.x0},${first.y0} ` + segs.map(s => `C${s.cp1x},${s.cp1y} ${s.cp2x},${s.cp2y} ${s.x1},${s.y1}`).join(' ')
  return `${top} L${last.x1},${BASELINE_Y} L${first.x0},${BASELINE_Y} Z`
})

/** One knot per fine-grained speed sample (grade change AND surface change, not just surface change -
 * see `RouteSurfaceSpeedProfile.speedSamples`), plus a start/end knot at the route's own start/end so
 * the curve is defined all the way to both edges instead of stopping short at the first/last sample. */
const knots = computed(() => {
  const samples = speedSamples.value
  if (!samples || samples.length === 0) return []
  return [
    { distanceM: 0, speedKmh: samples[0]!.avgSpeedKmh },
    ...samples.map(s => ({ distanceM: s.distanceM, speedKmh: s.avgSpeedKmh })),
    { distanceM: totalDistanceM.value, speedKmh: samples[samples.length - 1]!.avgSpeedKmh }
  ]
})

const curveSegments = computed(() =>
  monotoneCubicSegments(knots.value.map(k => ({ x: scaleX(k.distanceM), y: scaleYSpeed(k.speedKmh) })))
)

/** y-position of the overall average speed - a subtle dotted reference line, more useful than the
 * previous solid line at the chart's own minimum speed (which read as an arbitrary floor the curve
 * sat on, not a meaningful value). */
const avgSpeedY = computed(() => profile.value ? scaleYSpeed(profile.value.overallAvgSpeedKmh) : BASELINE_Y)

const linePath = computed(() => {
  const segs = curveSegments.value
  if (!segs.length) return ''
  const first = segs[0]!
  return `M${first.x0},${first.y0} ` + segs.map(s => `C${s.cp1x},${s.cp1y} ${s.cp2x},${s.cp2y} ${s.x1},${s.y1}`).join(' ')
})
const areaPath = computed(() => {
  const segs = curveSegments.value
  if (!segs.length) return ''
  const first = segs[0]!
  const last = segs[segs.length - 1]!
  const top = `M${first.x0},${first.y0} ` + segs.map(s => `C${s.cp1x},${s.cp1y} ${s.cp2x},${s.cp2y} ${s.x1},${s.y1}`).join(' ')
  return `${top} L${last.x1},${BASELINE_Y} L${first.x0},${BASELINE_Y} Z`
})

/** Dashed, muted "if you rode this solo" overlay line - drafted modes only (see `soloComparison`). Same knot/curve treatment as the main series, no area fill. */
const soloLinePath = computed(() => {
  const samples = soloComparison.value?.speedSamples
  if (!samples || samples.length === 0) return ''
  const soloKnots = [
    { distanceM: 0, speedKmh: samples[0]!.avgSpeedKmh },
    ...samples.map(s => ({ distanceM: s.distanceM, speedKmh: s.avgSpeedKmh })),
    { distanceM: totalDistanceM.value, speedKmh: samples[samples.length - 1]!.avgSpeedKmh }
  ]
  const segs = monotoneCubicSegments(soloKnots.map(k => ({ x: scaleX(k.distanceM), y: scaleYSpeed(k.speedKmh) })))
  if (!segs.length) return ''
  const first = segs[0]!
  return `M${first.x0},${first.y0} ` + segs.map(s => `C${s.cp1x},${s.cp1y} ${s.cp2x},${s.cp2y} ${s.x1},${s.y1}`).join(' ')
})

/** The strip below the curve marks each real surface segment's exact position in the site's two
 * surface colours, tarmac in the strong rule - the same strip the Course hero draws, so a surface
 * reads the same in both pictures. */
const stripBars = computed(() => (segments.value ?? []).map((segment) => {
  const x0 = scaleX(segment.fromKm * 1000)
  const x1 = scaleX(segment.toKm * 1000)
  return {
    ...segment,
    x: x0,
    width: Math.max(1, x1 - x0),
    fillClass: SURFACE_TYPE_FILL_COLORS[segment.surface],
    title: `${segment.fromKm.toFixed(1)}-${segment.toKm.toFixed(1)} km · ${SURFACE_TYPE_LABELS[segment.surface]} · ${segment.avgSpeedKmh.toFixed(1)} km/h`
      + (segment.extraWattsVsTarmac > 0 ? ` · +${segment.extraWattsVsTarmac} W vs. tarmac` : '')
  }
}))

const worstSegment = computed(() => {
  const list = segments.value?.filter(s => (s.toKm - s.fromKm) >= MIN_PENALTY_SEGMENT_KM)
  if (!list?.length) return undefined
  return list.reduce((worst, s) => s.extraWattsVsTarmac > worst.extraWattsVsTarmac ? s : worst, list[0]!)
})
const summaryText = computed(() => {
  const worst = worstSegment.value
  if (!worst || worst.extraWattsVsTarmac <= 0) return undefined
  return `Biggest surface penalty: ~${worst.extraWattsVsTarmac} W extra to hold pace on the ${SURFACE_TYPE_LABELS[worst.surface].toLowerCase()} at km ${worst.fromKm.toFixed(1)}-${worst.toKm.toFixed(1)}.`
})
</script>

<template>
  <div>
    <div
      v-if="computing"
      class="flex justify-center py-10"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin text-muted"
      />
    </div>
    <template v-else-if="profile">
      <p class="mb-2 text-sm text-muted">
        <span class="font-medium text-highlighted">{{ profile.overallAvgSpeedKmh.toFixed(1) }} km/h</span> average over the whole simulated ride
      </p>
      <svg
        :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
        class="w-full h-auto"
        role="img"
        aria-label="Average speed by surface segment"
      >
        <path
          :d="elevationAreaPath"
          fill="currentColor"
          class="text-muted"
          opacity="0.1"
        />
        <line
          v-if="profile"
          :x1="PAD_LEFT"
          :x2="VIEW_WIDTH - PAD_RIGHT"
          :y1="avgSpeedY"
          :y2="avgSpeedY"
          stroke="currentColor"
          class="text-muted"
          stroke-width="1"
          stroke-dasharray="1 3"
          opacity="0.6"
        >
          <title>{{ profile.overallAvgSpeedKmh.toFixed(1) }} km/h average</title>
        </line>
        <path
          :d="areaPath"
          fill="currentColor"
          class="text-highlighted"
          opacity="0.1"
        />
        <path
          :d="linePath"
          fill="none"
          stroke="currentColor"
          class="text-highlighted"
          stroke-width="1.75"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <path
          v-if="soloLinePath"
          :d="soloLinePath"
          fill="none"
          stroke="currentColor"
          class="text-muted"
          stroke-width="1.5"
          stroke-dasharray="5 4"
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity="0.8"
        >
          <title>Solo at equivalent average power</title>
        </path>
        <rect
          v-for="bar in stripBars"
          :key="`${bar.fromKm}-${bar.toKm}`"
          :x="bar.x"
          :y="STRIP_Y"
          :width="bar.width"
          :height="STRIP_HEIGHT"

          :class="bar.fillClass"
        >
          <title>{{ bar.title }}</title>
        </rect>
      </svg>
      <p class="mt-1 flex justify-between text-xs text-muted">
        <span>0 km</span>
        <span>{{ minSpeedKmh.toFixed(0) }} to {{ maxSpeedKmh.toFixed(0) }} km/h</span>
        <span>{{ formatDistance(totalDistanceM / 1000) }}</span>
      </p>

      <div
        v-if="soloComparison"
        class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
      >
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block w-5 border-t-2 border-ink" /><template v-if="soloComparison.frontPullPowerW">In the paceline (~{{ soloComparison.frontPullPowerW }} W on your pulls)</template><template v-else>In a typical race bunch</template>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block w-5 border-t-2 border-dashed border-current" />Same effort solo, no draft ({{ soloComparison.overallAvgSpeedKmh.toFixed(1) }} km/h avg)
        </span>
      </div>

      <p
        v-if="summaryText"
        class="mt-3 text-sm text-muted"
      >
        {{ summaryText }}
      </p>

      <div class="mt-4 border-t border-default">
        <div
          v-for="segment in segments"
          :key="`${segment.fromKm}-${segment.toKm}-row`"
          class="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-b border-default py-1.5 text-sm"
        >
          <span class="inline-flex items-center gap-1.5 font-medium">
            <span
              class="inline-block size-2.5 rounded-[2px]"
              :class="SURFACE_TYPE_COLORS[segment.surface]"
              aria-hidden="true"
            />
            {{ SURFACE_TYPE_LABELS[segment.surface] }}
            <span class="text-muted font-normal">{{ segment.fromKm.toFixed(1) }}-{{ segment.toKm.toFixed(1) }} km</span>
          </span>
          <span class="flex gap-x-3 text-toned">
            <span>{{ segment.avgSpeedKmh.toFixed(1) }} km/h</span>
            <span>{{ formatGrade(segment.avgGradePercent) }}</span>
            <span v-if="segment.extraWattsVsTarmac > 0">+{{ segment.extraWattsVsTarmac }} W vs. tarmac</span>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
