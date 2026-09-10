<script setup lang="ts">
import type { SegmentSummary } from '../../shared/types/catalog'

/**
 * A segment as the segments page lists it: what it is (name, world, climb or
 * sprint and its category) and the three numbers a rider picks a climb or a
 * sprint by. The stat rows are the ride briefing's, the same as `RouteCard`'s,
 * so the two discovery pages and the ranking page they lead to read as one
 * design of the same facts.
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
  <ULink :to="`/segments/${segment.slug}`">
    <UCard
      class="h-full transition hover:ring-primary/50"
      :ui="{ body: 'space-y-3' }"
    >
      <div class="flex items-start justify-between gap-2">
        <!-- `min-w-0` so a long name wraps inside its own column instead of
             widening the card past its grid cell. -->
        <div class="min-w-0">
          <p class="font-semibold text-highlighted">
            {{ segment.name }}
          </p>
          <p class="text-sm text-muted">
            {{ segment.worldName }}
          </p>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1.5">
          <UBadge
            :color="segment.type === 'climb' ? 'success' : 'warning'"
            variant="subtle"
            :icon="segment.type === 'climb' ? 'i-lucide-mountain' : 'i-lucide-zap'"
          >
            {{ segment.type === "climb" ? "Climb" : "Sprint" }}
            <template v-if="segment.climbType"> ({{ segment.climbType === "HC" ? "HC" : `Cat ${segment.climbType}` }})</template>
          </UBadge>
        </div>
      </div>

      <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
        <span class="inline-flex items-center gap-2">
          <UIcon
            name="i-lucide-ruler"
            class="size-4 shrink-0"
          />{{ formatDistance(segment.lengthKm) }}
        </span>
        <span class="inline-flex items-center gap-2">
          <UIcon
            name="i-lucide-trending-up"
            class="size-4 shrink-0"
          />{{ formatElevation(segment.measuredElevationM ?? segment.elevationM) }}
        </span>
        <span class="inline-flex items-center gap-2">
          <UIcon
            name="i-lucide-triangle-right"
            class="size-4 shrink-0"
          />{{ (segment.measuredAvgGradePercent ?? segment.avgGradePercent) ? formatGrade(segment.measuredAvgGradePercent ?? segment.avgGradePercent) : "Flat" }}
        </span>
      </div>
    </UCard>
  </ULink>
</template>
