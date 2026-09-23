<script setup lang="ts">
import type { RouteWithMeta } from '../../shared/types/catalog'
import { routeSilhouette } from '#shared/utils/silhouette'

/**
 * The Course hero (see `CONTEXT.md`): the Ride's elevation profile drawn
 * large at the top of a ranking page, in the neutral ink, with its surfaces
 * on a strip beneath and its named climbs as bands, its sprints as marks and
 * - on a race - its scoring segments starred. Hovering or touching it reads
 * the kilometre, elevation, grade and surface at that point.
 *
 * It is the Silhouette (`routeSilhouette`), so it is the very geometry the
 * finish time was simulated over, for the lap count the rider has chosen
 * with the lead-in once. Ride-only: it never waits for a Ranking, and a
 * route with no measured profile gets a line saying its terrain is
 * approximated instead of a drawing of the model's own guess.
 *
 * The SVG stretches to its box (`preserveAspectRatio="none"`), so every
 * stroke is `non-scaling` and every label is HTML over it rather than SVG
 * text, which would stretch with the box.
 */
const props = defineProps<{
  /** The route, or the synthetic segment-as-route a segment page ranks against. */
  route: RouteWithMeta
  laps: number
  /** What the hero draws, in the page's words - for its accessible name. */
  name: string
  /** Scoring segments to star, on a race page. */
  scoringSlugs?: string[]
}>()

const shape = computed(() => routeSilhouette(props.route, props.laps))

const VIEW_WIDTH = 1000
const VIEW_HEIGHT = 240
const PAD_TOP = 22
const PAD_BOTTOM = 10

const scaleX = (fraction: number) => fraction * VIEW_WIDTH
const scaleY = (height: number) => VIEW_HEIGHT - PAD_BOTTOM - height * (VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM)

const linePath = computed(() => {
  const points = shape.value?.points ?? []
  return points.map((point, index) => `${index ? 'L' : 'M'}${scaleX(point.x).toFixed(1)},${scaleY(point.y).toFixed(1)}`).join(' ')
})
const areaPath = computed(() => linePath.value ? `${linePath.value} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z` : '')

const scoring = computed(() => new Set(props.scoringSlugs ?? []))

/** Where each lap after the first starts, as fractions - dashed, so repeated laps read as laps. */
const lapStarts = computed(() => {
  const total = shape.value?.totalDistanceM
  if (!total || props.laps < 2) return []
  const leadInM = (props.route.leadInDistance ?? 0) * 1000
  const lapM = props.route.distance * 1000
  return Array.from({ length: props.laps - 1 }, (_, index) => (leadInM + (index + 1) * lapM) / total)
})

/**
 * The climb and sprint names over the profile. The first pass of each is
 * labelled - three laps of the same KOM need one name, not three - longest
 * first, so where two would collide the bigger climb keeps its name; the
 * band itself stays either way, and the course section lists every pass.
 */
const labels = computed(() => {
  if (!shape.value) return []
  const seen = new Set<string>()
  const candidates = [
    ...shape.value.climbs.map(band => ({ ...band, kind: 'climb' as const })),
    ...shape.value.sprints.map(band => ({ ...band, kind: 'sprint' as const }))
  ].filter((band) => {
    if (seen.has(band.slug)) return false
    seen.add(band.slug)
    return true
  }).sort((a, b) => (b.kind === 'climb' ? 1 : 0) - (a.kind === 'climb' ? 1 : 0) || (b.to - b.from) - (a.to - a.from))
  const placed: { key: string, name: string, at: number, kind: 'climb' | 'sprint', scoring: boolean }[] = []
  for (const band of candidates) {
    const at = (band.from + band.to) / 2
    if (placed.some(label => Math.abs(label.at - at) < 0.12)) continue
    placed.push({ key: `${band.slug}-${band.from}`, name: band.name, at, kind: band.kind, scoring: scoring.value.has(band.slug) })
  }
  return placed.sort((a, b) => a.at - b.at)
})

const stars = computed(() => shape.value
  ? [...shape.value.climbs, ...shape.value.sprints]
      .filter(band => scoring.value.has(band.slug))
      .map(band => ({ key: `${band.slug}-${band.from}`, at: (band.from + band.to) / 2 }))
  : [])

const totalKm = computed(() => (shape.value?.totalDistanceM ?? 0) / 1000)
const summary = computed(() => {
  if (!shape.value) return ''
  const climbs = new Set(shape.value.climbs.map(band => band.slug)).size
  const sprints = new Set(shape.value.sprints.map(band => band.slug)).size
  const parts = [`${formatDistance(totalKm.value)}`, `${formatElevation(shape.value.maxElevationM - shape.value.minElevationM)} between its lowest and highest points`]
  if (climbs) parts.push(`${climbs} named climb${climbs === 1 ? '' : 's'}`)
  if (sprints) parts.push(`${sprints} sprint${sprints === 1 ? '' : 's'}`)
  return `Elevation profile of ${props.name}: ${parts.join(', ')}.`
})

// The readout. A mouse hides it when it leaves; a finger keeps the last
// reading, because on a touch screen the pointer "leaves" the moment it
// lifts, which would take the answer away as it was given.
const plot = ref<HTMLElement>()
const readout = ref<{ at: number, top: number, text: string }>()

function read(event: PointerEvent) {
  const box = plot.value?.getBoundingClientRect()
  const points = shape.value?.points
  if (!box || !points?.length || box.width <= 0) return
  const at = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
  const found = points.findIndex(point => point.x >= at)
  const index = Math.max(1, found === -1 ? points.length - 1 : found)
  const a = points[index - 1]!
  const b = points[index]!
  const spanM = b.distanceM - a.distanceM
  const t = b.x > a.x ? (at - a.x) / (b.x - a.x) : 0
  const elevationM = a.elevationM + (b.elevationM - a.elevationM) * t
  const height = a.y + (b.y - a.y) * t
  const grade = spanM > 0 ? ((b.elevationM - a.elevationM) / spanM) * 100 : 0
  const surface = shape.value!.surfaces.find(span => at >= span.from && at <= span.to)?.surface
  const parts = [`km ${(at * totalKm.value).toFixed(1)}`, formatElevation(elevationM), `${grade >= 0 ? '+' : ''}${formatGrade(grade)}`]
  if (surface) parts.push(SURFACE_TYPE_LABELS[surface as keyof typeof SURFACE_TYPE_LABELS] ?? surface)
  readout.value = { at, top: scaleY(height) / VIEW_HEIGHT, text: parts.join(' · ') }
}

function leave(event: PointerEvent) {
  if (event.pointerType === 'mouse') readout.value = undefined
}
</script>

<template>
  <figure
    v-if="shape"
    id="course-hero"
    class="mt-5 sm:mt-7"
  >
    <div
      ref="plot"
      class="relative h-28 touch-pan-y select-none sm:h-40 md:h-56"
      role="img"
      :aria-label="summary"
      @pointermove="read"
      @pointerdown="read"
      @pointerleave="leave"
    >
      <svg
        :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
        preserveAspectRatio="none"
        class="block size-full overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id="course-hero-fill"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop
              offset="0"
              class="[stop-color:var(--ui-text-highlighted)]"
              stop-opacity="0.22"
            />
            <stop
              offset="1"
              class="[stop-color:var(--ui-text-highlighted)]"
              stop-opacity="0.02"
            />
          </linearGradient>
        </defs>
        <rect
          v-for="band in shape.climbs"
          :key="`band-${band.slug}-${band.from}`"
          :x="scaleX(band.from)"
          :width="Math.max(1, scaleX(band.to) - scaleX(band.from))"
          y="0"
          :height="VIEW_HEIGHT"
          class="fill-primary"
          :opacity="scoring.has(band.slug) ? 0.14 : 0.07"
        />
        <path
          :d="areaPath"
          fill="url(#course-hero-fill)"
        />
        <line
          v-for="start in lapStarts"
          :key="`lap-${start}`"
          :x1="scaleX(start)"
          :x2="scaleX(start)"
          :y1="PAD_TOP"
          :y2="VIEW_HEIGHT"
          class="stroke-rule-strong"
          stroke-dasharray="3 4"
          vector-effect="non-scaling-stroke"
        />
        <path
          :d="linePath"
          fill="none"
          class="stroke-ink"
          stroke-width="1.6"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-for="band in shape.sprints"
          :key="`sprint-${band.slug}-${band.from}`"
          :x1="scaleX(band.from)"
          :x2="scaleX(band.from)"
          :y1="VIEW_HEIGHT"
          :y2="VIEW_HEIGHT - 44"
          class="stroke-ink-toned"
          stroke-width="1.5"
          stroke-dasharray="3 3"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-for="band in shape.climbs"
          :key="`base-${band.slug}-${band.from}`"
          :x1="scaleX(band.from)"
          :x2="scaleX(band.to)"
          :y1="VIEW_HEIGHT - 1.5"
          :y2="VIEW_HEIGHT - 1.5"
          class="stroke-primary"
          stroke-width="3"
          vector-effect="non-scaling-stroke"
        />
        <line
          x1="0"
          :x2="VIEW_WIDTH"
          :y1="VIEW_HEIGHT"
          :y2="VIEW_HEIGHT"
          class="stroke-rule-strong"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <span
        v-for="label in labels"
        :key="label.key"
        class="absolute top-0 hidden -translate-x-1/2 whitespace-nowrap text-xs md:block"
        :class="label.scoring ? 'text-primary' : 'text-muted'"
        :style="{ left: `${(label.at * 100).toFixed(2)}%` }"
        aria-hidden="true"
      >{{ label.scoring ? '★ ' : '' }}{{ label.name }}</span>
      <span
        v-for="star in stars"
        :key="star.key"
        class="absolute top-4 -translate-x-1/2 text-sm text-primary md:hidden"
        :style="{ left: `${(star.at * 100).toFixed(2)}%` }"
        aria-hidden="true"
      >★</span>

      <template v-if="readout">
        <span
          class="pointer-events-none absolute inset-y-0 w-px bg-ink/50"
          :style="{ left: `${(readout.at * 100).toFixed(2)}%` }"
          aria-hidden="true"
        />
        <span
          class="pointer-events-none absolute z-10 -translate-y-[115%] whitespace-nowrap rounded-md border border-accented bg-elevated px-2.5 py-1 text-xs text-highlighted shadow-lg"
          :class="readout.at > 0.75 ? '-translate-x-full' : readout.at < 0.25 ? '' : '-translate-x-1/2'"
          :style="{ left: `${(readout.at * 100).toFixed(2)}%`, top: `${(readout.top * 100).toFixed(2)}%` }"
          aria-hidden="true"
        >{{ readout.text }}</span>
      </template>
    </div>

    <div
      v-if="shape.surfaces.length"
      class="mt-2 flex h-2 overflow-hidden rounded-[2px]"
      aria-hidden="true"
    >
      <span
        v-for="(span, index) in shape.surfaces"
        :key="index"
        class="block h-full"
        :class="SURFACE_FAMILY_BG[span.family]"
        :style="{ width: `${((span.to - span.from) * 100).toFixed(3)}%` }"
      />
    </div>
    <figcaption class="mt-2 flex justify-between text-xs text-muted">
      <span>0 km</span>
      <span>{{ formatDistance(totalKm / 2) }}</span>
      <span>{{ formatDistance(totalKm) }}</span>
    </figcaption>
  </figure>
  <p
    v-else
    id="course-hero-unavailable"
    class="mt-5 text-sm text-muted"
  >
    No measured elevation profile for this ride, so its terrain is approximated from its distance and total climbing.
  </p>
</template>
