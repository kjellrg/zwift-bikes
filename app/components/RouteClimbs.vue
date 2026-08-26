<script setup lang="ts">
import type { RouteClimbOccurrence } from '../../shared/utils/routeClimbs'

defineProps<{
  climbs: RouteClimbOccurrence[]
}>()
</script>

<template>
  <div
    v-if="climbs.length"
    class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
  >
    <ULink
      v-for="(climb, index) in climbs"
      :key="`${climb.slug}-${climb.rideFromKm}-${index}`"
      :to="`/segments/${climb.slug}`"
    >
      <UCard class="h-full transition hover:ring-primary/50">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-semibold text-highlighted">
              {{ climb.name }}
            </p>
            <p class="text-xs text-muted">
              from km {{ climb.rideFromKm.toFixed(1) }}
              <template v-if="climb.lapNumber">
                &middot; lap {{ climb.lapNumber }}
              </template>
            </p>
          </div>
          <UBadge
            v-if="climb.climbType"
            :color="CLIMB_TYPE_COLORS[climb.climbType]"
            variant="subtle"
          >
            {{ climb.climbType === "HC" ? "HC" : `Cat ${climb.climbType}` }}
          </UBadge>
        </div>
        <div class="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <p class="text-xs text-muted uppercase tracking-wide">
              Length
            </p>
            <p class="font-bold">
              {{ climb.lengthKm.toFixed(1) }} km
            </p>
          </div>
          <div>
            <p class="text-xs text-muted uppercase tracking-wide">
              Elev.
            </p>
            <p class="font-bold">
              {{ formatElevation(climb.elevationM) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-muted uppercase tracking-wide">
              Avg grade
            </p>
            <p class="font-bold">
              {{ formatGrade(climb.avgGradePercent) }}
            </p>
          </div>
        </div>
      </UCard>
    </ULink>
  </div>
</template>
