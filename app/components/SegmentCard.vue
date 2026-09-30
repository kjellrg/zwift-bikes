<script setup lang="ts">
import type { SegmentSummary } from '../../shared/types/catalog'
import { segmentGrade, wedgeShape, type WedgeScale } from '../utils/segmentWedge'

/**
 * A segment as the segments page lists it. A climb is a row: its name, a
 * muted line of category, length, climbing and grade, and a wedge that draws
 * its shape from the two numbers that make one - width is length, height is
 * average grade, both on the page's one scale (`wedgeScale`; the width under a
 * square root, so a short climb is not a sliver). A sprint is a name and a length in a compact
 * list: it has no climbing or grade worth a line. Climb or sprint is said by
 * the section a segment is in, not by a tag on it.
 *
 * The wedge is a shape made of two numbers, not a silhouette of the road -
 * the listing carries a segment's length, climbing and grade, not its shape.
 * Elevation and grade prefer the measured pair over `zwift-data`'s published
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
const shape = computed(() => wedgeShape(props.segment, props.scale))
</script>

<template>
  <NuxtLink
    v-if="segment.type === 'climb'"
    :to="`/segments/${segment.slug}`"
    class="group flex items-center justify-between gap-4 border-b border-default py-2.5"
  >
    <span class="min-w-0">
      <span class="block font-semibold text-highlighted group-hover:underline">{{ segment.name }}</span>
      <span class="block text-sm text-muted">{{ category }} · {{ segment.lengthKm.toFixed(1) }} km · {{ Math.round(segment.measuredElevationM ?? segment.elevationM) }} m · {{ grade ? formatGrade(grade) : 'Flat' }}</span>
    </span>
    <span
      class="relative h-8 w-24 shrink-0"
      aria-hidden="true"
    >
      <span
        class="absolute right-0 bottom-0 bg-ink-toned transition-colors group-hover:bg-primary"
        :style="{
          width: `${(shape.width * 100).toFixed(1)}%`,
          height: `${Math.max(shape.height * 100, 6).toFixed(1)}%`,
          clipPath: 'polygon(0 100%, 100% 100%, 100% 0)'
        }"
      />
    </span>
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
