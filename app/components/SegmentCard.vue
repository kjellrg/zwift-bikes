<script setup lang="ts">
import type { SegmentSummary } from '../../shared/types/catalog'

/**
 * A segment as the segments page lists it, the way `RouteCard` lists a
 * route. A climb is a card: its own outline first, drawn from the measured
 * profile the segment page charts (a `Silhouette`, each climb to its own
 * height, so a gentle drag reads as gentle), then its name, and at the foot
 * its category over the numbers a rider picks a climb by - length, climbing,
 * grade - as plain text. A climb with no measured profile draws a dashed
 * baseline rather than a shape nobody has ridden. A sprint is a name and a
 * length in a compact list: it has no climbing or grade worth a card.
 *
 * Elevation and grade prefer the measured pair over `zwift-data`'s published
 * scalars wherever both exist - see `SegmentSummary`: every display surface
 * does, and a card that disagreed with the segment page it links to would be
 * the one place a rider could catch the site contradicting itself.
 */
const props = defineProps<{
  segment: SegmentSummary
}>()

const category = computed(() => props.segment.climbType ? (props.segment.climbType === 'HC' ? 'HC climb' : `Category ${props.segment.climbType} climb`) : 'Climb')
const grade = computed(() => props.segment.measuredAvgGradePercent ?? props.segment.avgGradePercent)
</script>

<template>
  <NuxtLink
    v-if="segment.type === 'climb'"
    :to="`/segments/${segment.slug}`"
    class="flex h-full flex-col rounded-xl border border-default bg-elevated px-4 pt-3.5 pb-3.5 transition-colors hover:border-accented"
  >
    <RouteSilhouette
      :shape="segment.shape"
      class="h-14"
    />
    <span class="mt-3 block font-semibold text-balance text-highlighted">{{ segment.name }}</span>
    <span class="mt-auto block pt-1.5">
      <span class="block text-sm text-muted">{{ category }}</span>
      <span class="mt-0.5 flex flex-wrap gap-x-3 text-sm text-toned">
        <span><span class="font-semibold text-highlighted">{{ segment.lengthKm.toFixed(1) }}</span> km</span>
        <span><span class="font-semibold text-highlighted">{{ Math.round(segment.measuredElevationM ?? segment.elevationM) }}</span> m</span>
        <span>{{ grade ? formatGrade(grade) : 'Flat' }}</span>
      </span>
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
