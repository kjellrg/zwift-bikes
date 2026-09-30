<script setup lang="ts">
import type { SegmentSummary } from '../../shared/types/catalog'
import { climbDrawing, segmentGrade, type WedgeScale } from '../utils/segmentWedge'

/**
 * A segment as the segments page lists it. A climb is a row: its name, a
 * muted line of category, length, climbing and grade, and a wedge that draws
 * its own profile: every drawing is the same width, on the page's one
 * vertical scale (`wedgeScale`), so it is as tall as the climb is steep. The
 * length is in the muted line, not in the drawing. A sprint is a name and a length in a compact
 * list: it has no climbing or grade worth a line. Climb or sprint is said by
 * the section a segment is in, not by a tag on it.
 *
 * The profile is the climb's own measured one (`profileM`) where it has one,
 * and a straight ramp at its average grade where it has none - never a shape
 * made up to look like a road. Elevation and grade prefer the measured pair over `zwift-data`'s published
 * scalars wherever both exist - see `SegmentSummary`: every display surface
 * does, and a row that disagreed with the segment page it links to would be
 * the one place a rider could catch the site contradicting itself.
 */
const props = defineProps<{
  segment: SegmentSummary
  scale: WedgeScale
}>()

const category = computed(() => props.segment.climbType ? (props.segment.climbType === 'HC' ? 'HC' : `Cat ${props.segment.climbType}`) : 'Climb')
const grade = computed(() => segmentGrade(props.segment))
const VIEW_WIDTH = 100
const VIEW_HEIGHT = 40
const outline = computed(() => climbDrawing(props.segment, props.scale)
  .map(point => `${(point.x * VIEW_WIDTH).toFixed(1)},${(VIEW_HEIGHT - Math.max(point.y * VIEW_HEIGHT, 0.75)).toFixed(1)}`))
const area = computed(() => `0,${VIEW_HEIGHT} ${outline.value.join(' ')} ${VIEW_WIDTH},${VIEW_HEIGHT}`)
</script>

<template>
  <NuxtLink
    v-if="segment.type === 'climb'"
    :to="`/segments/${segment.slug}`"
    class="group flex items-center justify-between gap-4 border-b border-default py-2"
  >
    <span class="min-w-0">
      <span class="block font-semibold text-highlighted group-hover:underline">{{ segment.name }}</span>
      <span class="block text-sm text-muted">{{ category }} · {{ segment.lengthKm.toFixed(1) }} km · {{ Math.round(segment.measuredElevationM ?? segment.elevationM) }} m · {{ grade ? formatGrade(grade) : 'Flat' }}</span>
    </span>
    <!-- The climb's own profile in a track of one width for every climb,
         standing on a baseline, on the page's one vertical scale. -->
    <svg
      class="h-10 w-24 shrink-0 overflow-visible sm:w-40"
      :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon
        :points="area"
        class="fill-ink-toned transition-colors group-hover:fill-primary"
      />
      <line
        x1="0"
        :y1="VIEW_HEIGHT"
        :x2="VIEW_WIDTH"
        :y2="VIEW_HEIGHT"
        class="stroke-rule-strong"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  </NuxtLink>
  <NuxtLink
    v-else
    :to="`/segments/${segment.slug}`"
    class="group flex items-baseline justify-between gap-3 py-0.5 text-sm"
  >
    <span class="min-w-0 text-toned group-hover:text-highlighted group-hover:underline">{{ segment.name }}</span>
    <span class="shrink-0 text-muted">{{ segment.lengthKm.toFixed(1) }} km</span>
  </NuxtLink>
</template>
