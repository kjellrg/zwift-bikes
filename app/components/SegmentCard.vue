<script setup lang="ts">
import type { SegmentSummary } from '../../shared/types/catalog'

/**
 * A segment as the segments page lists it: what it is (name, world, climb or
 * sprint and its category) and the three numbers a rider picks a climb or a
 * sprint by, as plain text - climb or sprint is a small text tag, never a
 * coloured badge. No Silhouette: the listing carries a segment's length,
 * climbing and grade, not its shape, and a drawing made up from three
 * numbers would be a shape nobody has ridden.
 *
 * Elevation and grade prefer the measured pair over `zwift-data`'s published
 * scalars wherever both exist - see `SegmentSummary`: every display surface
 * does, and a card that disagreed with the segment page it links to would be
 * the one place a rider could catch the site contradicting itself.
 */
defineProps<{
  segment: SegmentSummary
}>()
</script>

<template>
  <NuxtLink
    :to="`/segments/${segment.slug}`"
    class="block h-full rounded-xl border border-default bg-elevated px-4 py-3.5 transition-colors hover:border-accented"
  >
    <span class="flex items-baseline justify-between gap-2">
      <span class="min-w-0 font-semibold text-highlighted">{{ segment.name }}</span>
      <span class="shrink-0 text-xs text-muted">{{ segment.type === 'climb' ? (segment.climbType ? (segment.climbType === 'HC' ? 'Climb, HC' : `Climb, cat ${segment.climbType}`) : 'Climb') : 'Sprint' }}</span>
    </span>
    <span class="mt-1 flex flex-wrap gap-x-3 text-sm text-toned">
      <span><span class="font-semibold text-highlighted">{{ segment.lengthKm.toFixed(1) }}</span> km</span>
      <span><span class="font-semibold text-highlighted">{{ Math.round(segment.measuredElevationM ?? segment.elevationM) }}</span> m</span>
      <span>{{ (segment.measuredAvgGradePercent ?? segment.avgGradePercent) ? formatGrade(segment.measuredAvgGradePercent ?? segment.avgGradePercent) : 'Flat' }}</span>
    </span>
  </NuxtLink>
</template>
