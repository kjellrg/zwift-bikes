<script setup lang="ts">
import type { SegmentSummary } from '../../shared/types/catalog'

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
        <div>
          <p class="font-semibold text-highlighted">
            {{ segment.name }}
          </p>
          <p class="text-sm text-muted">
            {{ segment.worldName }}
          </p>
        </div>
        <div class="flex flex-col items-end gap-1.5">
          <UBadge
            color="neutral"
            variant="subtle"
            icon="i-lucide-map-pin"
          >
            Segment
          </UBadge>
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

      <div class="flex flex-wrap gap-4 text-sm">
        <span class="inline-flex items-center gap-1.5">
          <UIcon
            name="i-lucide-ruler"
            class="size-4 text-muted"
          />
          {{ formatDistance(segment.lengthKm) }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <UIcon
            name="i-lucide-trending-up"
            class="size-4 text-muted"
          />
          {{ segment.avgGradePercent ? formatGrade(segment.avgGradePercent) : "Flat" }}
        </span>
      </div>
    </UCard>
  </ULink>
</template>
