<script setup lang="ts">
import type { RouteElevationPoint, RouteSegmentPlacement, RouteWithMeta } from '../../shared/types/catalog'
import type { RouteClimbOccurrence, SegmentOccurrence } from '../../shared/utils/routeOccurrences'
import { geometryForRouteLaps } from '#shared/utils/physics/routeGeometry'

const props = defineProps<{
  route: RouteWithMeta
  laps?: number
  /** Already lap-expanded occurrences, as used by the sibling `RouteClimbs`/`RouteSprints` cards - reused here so a
   * climb/sprint's position lines up with those cards without re-deriving lap expansion a second way. */
  climbs?: RouteClimbOccurrence[]
  sprints?: (RouteSegmentPlacement & SegmentOccurrence)[]
  /**
   * Segment slugs that score points in the event this profile is being shown
   * for, if any. Matching markers are starred and drawn more strongly, which
   * turns the profile into the answer to "when do I have to be at the front?"
   * - every scoring pass in ride order, including the repeats a table of
   * "3x Tidepool Sprint" can't place. Omitted everywhere but a race page, and
   * an empty or absent list renders exactly as before.
   */
  scoringSlugs?: string[]
}>()

const VIEW_WIDTH = 800
const VIEW_HEIGHT = 260
const PAD_LEFT = 42
const PAD_RIGHT = 12
const PAD_TOP = 14
const PAD_BOTTOM = 24
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM
/** Fraction of the plot's vertical range reserved as clear space above the highest point, so the
 * curve's peak sits below the top edge instead of touching it. */
const Y_HEADROOM_FRACTION = 0.15

/** Gradient bands used to color the profile, steepest last - mirrors the informal
 * red/orange/yellow/green climb-steepness convention riders already know from Strava/Zwift. */
const GRADE_BANDS = [
  { upTo: 0, label: 'Downhill', fillClass: 'fill-sky-400', dotClass: 'bg-sky-400' },
  { upTo: 3, label: '0-3%', fillClass: 'fill-emerald-400', dotClass: 'bg-emerald-400' },
  { upTo: 6, label: '3-6%', fillClass: 'fill-yellow-400', dotClass: 'bg-yellow-400' },
  { upTo: 9, label: '6-9%', fillClass: 'fill-orange-500', dotClass: 'bg-orange-500' },
  { upTo: Infinity, label: '9%+', fillClass: 'fill-red-500', dotClass: 'bg-red-500' }
] as const

function bandForGrade(gradePercent: number) {
  return GRADE_BANDS.find(band => gradePercent <= band.upTo) ?? GRADE_BANDS[GRADE_BANDS.length - 1]!
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
 * Monotone cubic Hermite interpolation (Fritsch-Carlson) between already pixel-scaled points, one
 * segment per point-to-point step. Real road grade changes gradually - straight lines between the
 * sparse, RDP-simplified elevation points read as artificial sharp "V" spikes even once the y-axis
 * floor above keeps their height in check. "Monotone" means a segment's curve never overshoots past
 * either endpoint's y-value, so it can't invent a dip/bump that isn't in the data. Always returns
 * `points.length - 1` segments (never skips a pair), including a degenerate straight "segment" for
 * any zero-width pair (e.g. a duplicate lap-boundary point), so callers can zip 1:1 by index.
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

const lapCount = computed(() => Math.max(1, Math.floor(props.laps ?? 1)))

/**
 * The ride's full shape - lead-in once, then every lap - in ride coordinates
 * (`distanceM: 0` at the true ride start), built by the same
 * `geometryForRouteLaps` the physics simulates over, so the curve, the
 * climb/sprint markers (`rideFromKm`-positioned) and the predicted times all
 * describe the identical ride by construction. `terrain.elevationProfile` is
 * lap-relative (normalized at generation time - see `routeSurfaces.ts`);
 * the geometry builder handles the lead-in prefix (measured shape where the
 * trace covered it, a straight line at the official average grade
 * otherwise) and the exact official lap spacing the marker offsets use.
 * Still gated on a measured profile existing: this card shows real GPS
 * shape or nothing, never the synthetic fallback geometry alone.
 */
const points = computed<RouteElevationPoint[]>(() => {
  const profile = props.route.terrain.elevationProfile
  if (!profile || profile.length < 2) return []
  return geometryForRouteLaps(props.route, lapCount.value).points
})

const totalDistanceM = computed(() => points.value.at(-1)?.distanceM ?? 0)

const minElevation = computed(() =>
  points.value.reduce((min, p) => Math.min(min, p.elevationM), points.value[0]?.elevationM ?? 0)
)
const maxElevation = computed(() =>
  points.value.reduce((max, p) => Math.max(max, p.elevationM), points.value[0]?.elevationM ?? 0)
)
/** Minimum span (in metres) the y-axis is allowed to zoom into. Without a floor, a near-flat
 * route's few metres of real elevation change get stretched to fill the whole plot height,
 * turning mild 1-2% rollers into what look like near-vertical cliffs. */
const MIN_ELEVATION_RANGE_M = 50
const elevationRange = computed(() => Math.max(MIN_ELEVATION_RANGE_M, maxElevation.value - minElevation.value))

function scaleX(distanceM: number) {
  if (totalDistanceM.value === 0) return PAD_LEFT
  return PAD_LEFT + (distanceM / totalDistanceM.value) * PLOT_WIDTH
}
function scaleY(elevationM: number) {
  const paddedRange = elevationRange.value * (1 + Y_HEADROOM_FRACTION)
  return PAD_TOP + PLOT_HEIGHT - ((elevationM - minElevation.value) / paddedRange) * PLOT_HEIGHT
}
const baselineY = computed(() => scaleY(minElevation.value))

/** Curve segment for each point-to-point step, in the same order/indices as `points` - shared by
 * `bands` and `linePath` below so the colored fill's top edge and the outline stroke always trace
 * the exact same smoothed curve. */
const curveSegments = computed(() =>
  monotoneCubicSegments(points.value.map(p => ({ x: scaleX(p.distanceM), y: scaleY(p.elevationM) })))
)

/** One filled shape per point-to-point step, colored by that step's own grade -
 * gives the profile a Strava-style gradient "heatmap" instead of a flat block color. */
const bands = computed(() => {
  const pts = points.value
  const segments = curveSegments.value
  const result: { d: string, fillClass: string, title: string }[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const distM = b.distanceM - a.distanceM
    if (distM <= 0) continue
    const grade = ((b.elevationM - a.elevationM) / distM) * 100
    const s = segments[i]!
    result.push({
      d: `M${s.x0},${baselineY.value} L${s.x0},${s.y0} C${s.cp1x},${s.cp1y} ${s.cp2x},${s.cp2y} ${s.x1},${s.y1} L${s.x1},${baselineY.value} Z`,
      fillClass: bandForGrade(grade).fillClass,
      title: `${(a.distanceM / 1000).toFixed(1)}-${(b.distanceM / 1000).toFixed(1)} km · ${formatGrade(grade)}`
    })
  }
  return result
})

const linePath = computed(() => {
  const segments = curveSegments.value
  if (!segments.length) return ''
  const first = segments[0]!
  return `M${first.x0},${first.y0} ` + segments.map(s => `C${s.cp1x},${s.cp1y} ${s.cp2x},${s.cp2y} ${s.x1},${s.y1}`).join(' ')
})

/** Dashed markers at each lap boundary (after the once-only lead-in, then every official lap length) so a
 * multi-lap profile reads as repeating laps, not one odd shape. */
const lapBoundaries = computed(() => {
  if (lapCount.value < 2) return []
  const leadInM = (props.route.leadInDistance ?? 0) * 1000
  const lapDistanceM = props.route.distance * 1000
  return Array.from({ length: lapCount.value - 1 }, (_, i) => leadInM + (i + 1) * lapDistanceM)
})

/**
 * Climb/sprint occurrences with a subtle highlighted x-range, positioned directly from the same
 * `rideFromKm`/`rideToKm` (ride-start-relative, lead-in included) the sibling cards use - which is
 * also what `points` above is keyed on, so no further offset is needed here. One-time lead-in
 * occurrences (`!perLap`) are kept too; only occurrences beyond the plotted lap count are dropped.
 */
const scoringSlugSet = computed(() => new Set(props.scoringSlugs ?? []))

const markers = computed(() => {
  const climbMarkers = (props.climbs ?? []).map(item => ({
    key: `climb-${item.slug}-${item.rideFromKm}`,
    kind: 'climb' as const,
    scoring: scoringSlugSet.value.has(item.slug),
    name: item.name,
    fromM: item.rideFromKm * 1000,
    toM: item.rideToKm * 1000,
    lengthKm: item.lengthKm,
    avgGradePercent: item.avgGradePercent,
    lapNumber: item.lapNumber
  }))
  const sprintMarkers = (props.sprints ?? []).map(item => ({
    key: `sprint-${item.slug}-${item.rideFromKm}`,
    kind: 'sprint' as const,
    scoring: scoringSlugSet.value.has(item.slug),
    name: item.name,
    fromM: item.rideFromKm * 1000,
    toM: item.rideToKm * 1000,
    lengthKm: item.lengthKm,
    avgGradePercent: item.avgGradePercent,
    lapNumber: item.lapNumber
  }))
  return [...climbMarkers, ...sprintMarkers]
    .filter(marker => marker.fromM < totalDistanceM.value && marker.toM > 0)
    .map(marker => ({
      ...marker,
      fromM: Math.max(0, Math.min(totalDistanceM.value, marker.fromM)),
      toM: Math.max(0, Math.min(totalDistanceM.value, marker.toM))
    }))
})

const MARKER_STYLES = {
  climb: { tintClass: 'fill-violet-500', barClass: 'fill-violet-500', dotClass: 'bg-violet-500', label: 'Climb' },
  sprint: { tintClass: 'fill-amber-400', barClass: 'fill-amber-500', dotClass: 'bg-amber-500', label: 'Sprint' }
}

function markerTitle(marker: (typeof markers.value)[number]) {
  const grade = marker.avgGradePercent ? ` · ${formatGrade(marker.avgGradePercent)}` : ''
  const lap = marker.lapNumber ? ` · lap ${marker.lapNumber}` : ''
  const scoring = marker.scoring ? ' · scores points' : ''
  return `${marker.name} · ${formatDistance(marker.lengthKm)}${grade}${lap} · from ${formatDistance(marker.fromM / 1000)}${scoring}`
}

/** Only worth a legend entry when something on this profile actually scores. */
const hasScoringMarkers = computed(() => markers.value.some(marker => marker.scoring))

const stats = computed(() => {
  const pts = points.value
  let ascent = 0
  let descent = 0
  let maxGrade = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const diff = b.elevationM - a.elevationM
    if (diff > 0) ascent += diff
    else descent -= diff
    const distM = b.distanceM - a.distanceM
    if (distM > 0) maxGrade = Math.max(maxGrade, Math.abs((diff / distM) * 100))
  }
  return { ascent, descent, maxGrade }
})
</script>

<template>
  <UCard v-if="points.length > 1">
    <UCollapsible :ui="{ content: 'mt-3' }">
      <template #default="{ open }">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left"
        >
          <span class="flex items-center gap-2">
            <p class="font-semibold text-highlighted">
              Elevation profile
            </p>
            <UTooltip
              text="From this route's real GPS elevation trace. Each stretch is colored by its own grade - blue for descents, green through red as climbs get steeper."
            >
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
        <svg
          :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
          class="w-full h-auto"
          role="img"
          aria-label="Elevation profile chart"
        >
          <line
            :x1="PAD_LEFT"
            :x2="VIEW_WIDTH - PAD_RIGHT"
            :y1="baselineY"
            :y2="baselineY"
            stroke="currentColor"
            class="text-default"
            stroke-width="1"
          />
          <g
            v-for="marker in markers"
            :key="marker.key"
          >
            <!-- A scoring pass is drawn as the same marker turned up, not as a
                 different shape: the rider still needs to read it as the sprint
                 or climb it is, just with the fact that points are on the line. -->
            <rect
              :x="scaleX(marker.fromM)"
              :width="Math.max(1, scaleX(marker.toM) - scaleX(marker.fromM))"
              :y="PAD_TOP"
              :height="PLOT_HEIGHT"
              :class="MARKER_STYLES[marker.kind].tintClass"
              :opacity="marker.scoring ? 0.24 : 0.12"
            >
              <title>{{ markerTitle(marker) }}</title>
            </rect>
            <rect
              :x="scaleX(marker.fromM)"
              :width="Math.max(1, scaleX(marker.toM) - scaleX(marker.fromM))"
              :y="PAD_TOP"
              :height="marker.scoring ? 5 : 3"
              :class="MARKER_STYLES[marker.kind].barClass"
            >
              <title>{{ markerTitle(marker) }}</title>
            </rect>
            <text
              v-if="marker.scoring"
              :x="(scaleX(marker.fromM) + scaleX(marker.toM)) / 2"
              :y="PAD_TOP + 17"
              text-anchor="middle"
              :class="MARKER_STYLES[marker.kind].barClass"
              font-size="12"
            >
              ★
              <title>{{ markerTitle(marker) }}</title>
            </text>
          </g>
          <line
            v-for="d in lapBoundaries"
            :key="d"
            :x1="scaleX(d)"
            :x2="scaleX(d)"
            :y1="PAD_TOP"
            :y2="baselineY"
            stroke="currentColor"
            class="text-default"
            stroke-width="1"
            stroke-dasharray="3 3"
          />
          <path
            v-for="(band, i) in bands"
            :key="i"
            :d="band.d"
            :class="band.fillClass"
            opacity="0.85"
          >
            <title>{{ band.title }}</title>
          </path>
          <path
            :d="linePath"
            fill="none"
            stroke="currentColor"
            class="text-highlighted"
            stroke-width="1"
            stroke-linejoin="round"
          />
          <text
            :x="PAD_LEFT - 6"
            :y="PAD_TOP + 4"
            text-anchor="end"
            fill="currentColor"
            class="text-muted"
            font-size="10"
          >
            {{ formatElevation(maxElevation) }}
          </text>
          <text
            :x="PAD_LEFT - 6"
            :y="baselineY"
            text-anchor="end"
            fill="currentColor"
            class="text-muted"
            font-size="10"
          >
            {{ formatElevation(minElevation) }}
          </text>
          <text
            :x="PAD_LEFT"
            :y="VIEW_HEIGHT - 8"
            text-anchor="start"
            fill="currentColor"
            class="text-muted"
            font-size="10"
          >
            0 km
          </text>
          <text
            :x="VIEW_WIDTH - PAD_RIGHT"
            :y="VIEW_HEIGHT - 8"
            text-anchor="end"
            fill="currentColor"
            class="text-muted"
            font-size="10"
          >
            {{ formatDistance(totalDistanceM / 1000) }}
          </text>
        </svg>

        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span><span class="font-medium text-highlighted">{{ formatElevation(stats.ascent) }}</span> ascent</span>
          <span><span class="font-medium text-highlighted">{{ formatElevation(stats.descent) }}</span> descent</span>
          <span>Max grade <span class="font-medium text-highlighted">{{ formatGrade(stats.maxGrade) }}</span></span>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            v-for="band in GRADE_BANDS"
            :key="band.label"
            class="inline-flex items-center gap-1 text-[11px] text-muted"
          >
            <span
              class="size-2 rounded-full inline-block"
              :class="band.dotClass"
            />
            {{ band.label }}
          </span>
        </div>

        <div
          v-if="markers.length"
          class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          <span
            v-for="kind in (['climb', 'sprint'] as const)"
            :key="kind"
            class="inline-flex items-center gap-1 text-[11px] text-muted"
          >
            <span
              class="size-2 rounded-full inline-block"
              :class="MARKER_STYLES[kind].dotClass"
            />
            {{ MARKER_STYLES[kind].label }}
          </span>
          <span
            v-if="hasScoringMarkers"
            class="inline-flex items-center gap-1 text-[11px] text-muted"
          >
            <span class="text-highlighted">★</span>
            Scores points
          </span>
        </div>
      </template>
    </UCollapsible>
  </UCard>
</template>
