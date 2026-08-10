<script setup lang="ts">
import type { RouteElevationPoint, RouteSegmentPlacement, RouteWithMeta } from '../../shared/types/catalog'
import type { RouteClimbOccurrence, SegmentOccurrence } from '../../shared/utils/routeClimbs'

const props = defineProps<{
  route: RouteWithMeta
  laps?: number
  /** Already lap-expanded occurrences, as used by the sibling `RouteClimbs`/`RouteSprints` cards - reused here so a
   * climb/sprint's position lines up with those cards without re-deriving lap expansion a second way. */
  climbs?: RouteClimbOccurrence[]
  sprints?: (RouteSegmentPlacement & SegmentOccurrence)[]
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

const lapCount = computed(() => Math.max(1, Math.floor(props.laps ?? 1)))

/** Despite its doc comment, `terrain.elevationProfile` is measured `distanceM: 0` at the true ride
 * start (Strava segment recording start) - lead-in included, not the lap start - confirmed by
 * cross-checking known climb positions (which *are* documented as ride-start-relative via
 * `rideFromKm`) against where the profile actually shows their elevation gain. So `distanceM: 0`
 * here already lines up with `rideFromKm: 0` with no lead-in adjustment needed. */
function interpolateElevationAt(profile: RouteElevationPoint[], distanceM: number): number {
  if (distanceM <= profile[0]!.distanceM) return profile[0]!.elevationM
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i]!
    const b = profile[i + 1]!
    if (distanceM >= a.distanceM && distanceM <= b.distanceM) {
      const span = b.distanceM - a.distanceM
      const t = span > 0 ? (distanceM - a.distanceM) / span : 0
      return a.elevationM + t * (b.elevationM - a.elevationM)
    }
  }
  return profile[profile.length - 1]!.elevationM
}

/**
 * The measured profile only covers one ride (lead-in once, then one lap). For additional laps,
 * repeat just the lap portion (from the lead-in's end onward) - using the *official* per-lap
 * distance as the repeat spacing, matching `rideFromKm`'s own lap offset, so climb/sprint markers
 * for later laps line up with the curve they're drawn over.
 */
const points = computed<RouteElevationPoint[]>(() => {
  const profile = props.route.terrain.elevationProfile
  if (!profile || profile.length < 2) return []
  if (lapCount.value <= 1) return profile

  const leadInM = (props.route.leadInDistance ?? 0) * 1000
  const lapDistanceM = props.route.distance * 1000
  const lapTail = [
    { distanceM: leadInM, elevationM: interpolateElevationAt(profile, leadInM) },
    ...profile.filter(p => p.distanceM > leadInM)
  ]

  const result: RouteElevationPoint[] = [...profile]
  for (let lap = 1; lap < lapCount.value; lap++) {
    const offset = lap * lapDistanceM
    for (const point of lapTail) {
      result.push({ distanceM: offset + point.distanceM, elevationM: point.elevationM })
    }
  }
  return result
})

const totalDistanceM = computed(() => points.value.at(-1)?.distanceM ?? 0)

const minElevation = computed(() =>
  points.value.reduce((min, p) => Math.min(min, p.elevationM), points.value[0]?.elevationM ?? 0)
)
const maxElevation = computed(() =>
  points.value.reduce((max, p) => Math.max(max, p.elevationM), points.value[0]?.elevationM ?? 0)
)
const elevationRange = computed(() => Math.max(1, maxElevation.value - minElevation.value))

function scaleX(distanceM: number) {
  if (totalDistanceM.value === 0) return PAD_LEFT
  return PAD_LEFT + (distanceM / totalDistanceM.value) * PLOT_WIDTH
}
function scaleY(elevationM: number) {
  const paddedRange = elevationRange.value * (1 + Y_HEADROOM_FRACTION)
  return PAD_TOP + PLOT_HEIGHT - ((elevationM - minElevation.value) / paddedRange) * PLOT_HEIGHT
}
const baselineY = computed(() => scaleY(minElevation.value))

/** One filled quad per point-to-point step, colored by that step's own grade -
 * gives the profile a Strava-style gradient "heatmap" instead of a flat block color. */
const bands = computed(() => {
  const pts = points.value
  const result: { d: string, fillClass: string, title: string }[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const distM = b.distanceM - a.distanceM
    if (distM <= 0) continue
    const grade = ((b.elevationM - a.elevationM) / distM) * 100
    const x1 = scaleX(a.distanceM)
    const x2 = scaleX(b.distanceM)
    const y1 = scaleY(a.elevationM)
    const y2 = scaleY(b.elevationM)
    result.push({
      d: `M${x1},${baselineY.value} L${x1},${y1} L${x2},${y2} L${x2},${baselineY.value} Z`,
      fillClass: bandForGrade(grade).fillClass,
      title: `${(a.distanceM / 1000).toFixed(1)}-${(b.distanceM / 1000).toFixed(1)} km · ${formatGrade(grade)}`
    })
  }
  return result
})

const linePath = computed(() => {
  const pts = points.value
  if (!pts.length) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${scaleX(p.distanceM)},${scaleY(p.elevationM)}`).join(' ')
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
const markers = computed(() => {
  const climbMarkers = (props.climbs ?? []).map(item => ({
    key: `climb-${item.slug}-${item.rideFromKm}`,
    kind: 'climb' as const,
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
  return `${marker.name} · ${formatDistance(marker.lengthKm)}${grade}${lap}`
}

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
            <rect
              :x="scaleX(marker.fromM)"
              :width="Math.max(1, scaleX(marker.toM) - scaleX(marker.fromM))"
              :y="PAD_TOP"
              :height="PLOT_HEIGHT"
              :class="MARKER_STYLES[marker.kind].tintClass"
              opacity="0.12"
            >
              <title>{{ markerTitle(marker) }}</title>
            </rect>
            <rect
              :x="scaleX(marker.fromM)"
              :width="Math.max(1, scaleX(marker.toM) - scaleX(marker.fromM))"
              :y="PAD_TOP"
              height="3"
              :class="MARKER_STYLES[marker.kind].barClass"
            >
              <title>{{ markerTitle(marker) }}</title>
            </rect>
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
        </div>
      </template>
    </UCollapsible>
  </UCard>
</template>
