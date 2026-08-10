<script setup lang="ts">
import type { RouteSegmentPlacement } from '../../shared/types/catalog'
import type { SegmentOccurrence } from '../../shared/utils/routeClimbs'

const props = defineProps<{
  sprints: (RouteSegmentPlacement & SegmentOccurrence)[]
  /** Route this occurrence list came from - passed through to the segment page link so its ranking uses this route's exact surface data. */
  routeSlug?: string
}>()

function segmentLink(slug: string) {
  return props.routeSlug ? `/segments/${slug}?route=${props.routeSlug}` : `/segments/${slug}`
}
</script>

<template>
  <div
    v-if="sprints.length"
    class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
  >
    <ULink
      v-for="(sprint, index) in sprints"
      :key="`${sprint.slug}-${sprint.rideFromKm}-${index}`"
      :to="segmentLink(sprint.slug)"
    >
      <UCard class="h-full transition hover:ring-primary/50">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-semibold text-highlighted">
              {{ sprint.name }}
            </p>
            <p class="text-xs text-muted">
              from km {{ sprint.rideFromKm.toFixed(1) }}
              <template v-if="sprint.lapNumber">
                &middot; lap {{ sprint.lapNumber }}
              </template>
            </p>
          </div>
          <UBadge
            color="warning"
            variant="subtle"
            icon="i-lucide-zap"
          >
            Sprint
          </UBadge>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-center">
          <div>
            <p class="text-xs text-muted uppercase tracking-wide">
              Length
            </p>
            <p class="font-bold">
              {{ formatDistance(sprint.lengthKm) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-muted uppercase tracking-wide">
              Avg grade
            </p>
            <p class="font-bold">
              {{ sprint.avgGradePercent ? formatGrade(sprint.avgGradePercent) : "Flat" }}
            </p>
          </div>
        </div>
      </UCard>
    </ULink>
  </div>
</template>
