<script setup lang="ts">
import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from '../../shared/types/catalog'
import type { DraftMode } from '../../shared/utils/physics/draft'
import { TTT_DEFAULT_RIDERS } from '#shared/utils/physics/draft'
import { computeRouteSurfaceSpeedProfile } from '#shared/utils/physics/routeSurfaceSpeedProfile'

const props = defineProps<{
  route: RouteWithMeta
  frame: ClassifiedBikeFrame
  wheelset?: Wheelset
  weightKg: number
  heightCm: number
  wkg: number
  draftMode?: DraftMode
  tttRiders?: number
  tttClimbWkg?: number
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

// Cheap, prop-only check - mirrors `computeRouteSurfaceSpeedProfile`'s own early-return guards, so
// the card's visibility can be decided without running the (expensive) simulation below.
const hasSurfaceData = computed(() =>
  (props.route.terrain.elevationProfile?.length ?? 0) >= 2
  && (props.route.surface.segments?.length ?? 0) > 0
)

// The simulation only runs once the panel has been expanded at least once - it's the same
// `simulateRoute` the server already ran for `topCombo` to get its finish time, so running it again
// eagerly (e.g. purely to populate the collapsed header's avg-speed badge) would duplicate that work
// on every page load even for users who never open this panel.
const hasOpened = ref(false)
const isComputing = ref(false)

// Always computed for one lap - see `computeRouteSurfaceSpeedProfile`'s own doc comment. The card title
// gets a "(per lap)" qualifier below for lap-based routes so this scope stays clear to the reader.
const profile = computed(() => hasOpened.value
  ? computeRouteSurfaceSpeedProfile(
      props.route,
      props.frame,
      props.wheelset,
      props.weightKg,
      props.heightCm,
      props.wkg,
      props.draftMode === 'ttt'
        ? { riders: props.tttRiders ?? TTT_DEFAULT_RIDERS, climbWkg: props.tttClimbWkg }
        : undefined
    )
  : undefined)

async function handleOpenChange(open: boolean) {
  if (!open || hasOpened.value) return
  isComputing.value = true
  await nextTick() // let the spinner paint before the synchronous simulation blocks the main thread
  hasOpened.value = true
  isComputing.value = false
}
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
/** Zooms into the route's own [min, max] speed range (headroom above the peak only, same convention as
 * RouteElevationProfile's `scaleY`) rather than anchoring to an absolute 0 km/h baseline - anchoring to
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
 * Monotone cubic Hermite interpolation (Fritsch-Carlson) between already pixel-scaled points - same
 * technique/implementation as RouteElevationProfile.vue's `monotoneCubicSegments`, kept local rather
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

// Sourced from `profile.elevationPoints` (the same simulated geometry the speed curve is built from),
// NOT `route.terrain.elevationProfile` directly - the raw profile's real GPS trace doesn't always cover
// the official lead-in + lap distance exactly, and `computeRouteSurfaceSpeedProfile` already rescales
// to correct for that. Using the raw, unscaled profile here would let this backdrop gradually drift out
// of alignment with the (correctly rescaled) speed curve over the course of the route.
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

/** A very subtle, single-tone (not color-coded by grade) elevation silhouette drawn behind the speed
 * curve - purely a visual reference so a dip in the speed curve can be read against the climb that
 * caused it. Deliberately flat-colored (`text-muted`, low opacity) rather than the grade-banded colors
 * RouteElevationProfile.vue uses, since here it's just backdrop, not the primary subject. */
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

/** Dashed, muted "if you rode this solo" overlay line - TTT draft mode only (see `soloComparison`). Same knot/curve treatment as the main series, no area fill. */
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

/** The strip below the curve marks each real surface segment's exact position/color - tarmac uses the
 * app's theme-adaptive `text-muted` token (via `currentColor`) rather than a fixed gray Tailwind shade,
 * so it recedes into the background in both themes instead of standing out as a bright, "in your face"
 * block against a dark theme. Non-tarmac surfaces keep their normal distinct colors, since they're the
 * point of the strip. */
const stripBars = computed(() => (segments.value ?? []).map((segment) => {
  const x0 = scaleX(segment.fromKm * 1000)
  const x1 = scaleX(segment.toKm * 1000)
  const isTarmac = segment.surface === 'tarmac'
  return {
    ...segment,
    x: x0,
    width: Math.max(1, x1 - x0),
    fillClass: isTarmac ? 'text-muted' : SURFACE_TYPE_FILL_COLORS[segment.surface],
    useCurrentColor: isTarmac,
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
  <UCard v-if="hasSurfaceData">
    <UCollapsible
      :ui="{ content: 'mt-3' }"
      @update:open="handleOpenChange"
    >
      <template #default="{ open }">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left"
        >
          <span class="flex items-center gap-2">
            <p class="font-semibold text-highlighted">
              Speed &amp; surface effort<span
                v-if="route.lap"
                class="font-normal text-muted"
              > (per lap)</span>
            </p>
            <UBadge
              v-if="profile"
              color="neutral"
              variant="subtle"
            >
              {{ profile.overallAvgSpeedKmh.toFixed(1) }} km/h avg
            </UBadge>
            <UTooltip text="Overall average speed is this bike/rider's simulated pace for the whole route (distance ÷ total time) - the fairest single number, since a route can mix short fast stretches with one long slow climb. The curve below tracks that same simulation's pace at every real grade AND surface change, not just where the surface changes, so climbs/descents show up even inside a long tarmac stretch - shown against a faint, uncolored elevation backdrop for reference; the strip beneath it marks the real surface behind each dip.">
              <UIcon
                name="i-lucide-info"
                class="size-4 text-muted"
                @click.stop
              />
            </UTooltip>
          </span>
          <UIcon
            :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="size-4 text-muted shrink-0"
          />
        </button>
      </template>

      <template #content>
        <div
          v-if="isComputing"
          class="flex justify-center py-10"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-5 animate-spin text-muted"
          />
        </div>
        <template v-else-if="profile">
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
              class="text-primary"
              opacity="0.18"
            />
            <path
              :d="linePath"
              fill="none"
              stroke="currentColor"
              class="text-primary"
              stroke-width="1.5"
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
              :fill="bar.useCurrentColor ? 'currentColor' : undefined"
              :class="bar.fillClass"
            >
              <title>{{ bar.title }}</title>
            </rect>
            <text
              :x="PAD_LEFT - 6"
              :y="PAD_TOP + 4"
              text-anchor="end"
              fill="currentColor"
              class="text-muted"
              font-size="10"
            >
              {{ maxSpeedKmh.toFixed(0) }} km/h
            </text>
            <text
              :x="PAD_LEFT - 6"
              :y="BASELINE_Y"
              text-anchor="end"
              fill="currentColor"
              class="text-muted"
              font-size="10"
            >
              {{ minSpeedKmh.toFixed(0) }}
            </text>
            <text
              :x="PAD_LEFT"
              :y="VIEW_HEIGHT - 6"
              text-anchor="start"
              fill="currentColor"
              class="text-muted"
              font-size="10"
            >
              0 km
            </text>
            <text
              :x="VIEW_WIDTH - PAD_RIGHT"
              :y="VIEW_HEIGHT - 6"
              text-anchor="end"
              fill="currentColor"
              class="text-muted"
              font-size="10"
            >
              {{ formatDistance(totalDistanceM / 1000) }}
            </text>
          </svg>

          <div
            v-if="soloComparison"
            class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
          >
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block w-5 border-t-2 border-primary" />In the paceline (~{{ soloComparison.frontPullPowerW }} W on your pulls)
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

          <div class="mt-4 space-y-1.5">
            <div
              v-for="segment in segments"
              :key="`${segment.fromKm}-${segment.toKm}-row`"
              class="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-sm"
            >
              <span class="inline-flex items-center gap-1.5 font-medium">
                <span
                  class="size-2 rounded-full inline-block"
                  :class="SURFACE_TYPE_COLORS[segment.surface]"
                />
                <UIcon
                  :name="SURFACE_TYPE_ICONS[segment.surface]"
                  class="size-3.5 text-muted"
                />
                {{ SURFACE_TYPE_LABELS[segment.surface] }}
                <span class="text-muted font-normal">{{ segment.fromKm.toFixed(1) }}-{{ segment.toKm.toFixed(1) }} km</span>
              </span>
              <span class="flex gap-x-3 text-xs text-muted">
                <span>{{ segment.avgSpeedKmh.toFixed(1) }} km/h</span>
                <span>{{ formatGrade(segment.avgGradePercent) }}</span>
                <span v-if="segment.extraWattsVsTarmac > 0">+{{ segment.extraWattsVsTarmac }} W vs. tarmac</span>
              </span>
            </div>
          </div>
        </template>
      </template>
    </UCollapsible>
  </UCard>
</template>
