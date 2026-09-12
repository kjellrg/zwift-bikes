<script setup lang="ts">
import type { RouteSummary } from '../../shared/types/catalog'

/**
 * A route as the homepage lists it: who it is (name, world, how it rides,
 * whether an event is the only way onto it) and the two numbers a rider
 * picks a route by. The stat rows are the ride briefing's - same icon, same
 * muted line - so that arriving on the route page reads as the same page
 * continuing rather than a different design of the same facts.
 */
defineProps<{
  route: RouteSummary
}>()
</script>

<template>
  <ULink :to="`/routes/${route.slug}`">
    <UCard
      class="h-full transition hover:ring-primary/50"
      :ui="{ body: 'space-y-3' }"
    >
      <div class="flex items-start justify-between gap-2">
        <!-- `min-w-0` so a long name wraps inside its own column instead of
             widening the card past its grid cell. -->
        <div class="min-w-0">
          <p class="font-semibold text-highlighted">
            {{ route.name }}
          </p>
          <p class="text-sm text-muted">
            {{ route.worldName }}
          </p>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1.5">
          <TerrainBadge :terrain="route.terrain" />
          <UBadge
            v-if="route.eventOnly"
            color="error"
            variant="subtle"
            icon="i-lucide-calendar-clock"
          >
            Event only
          </UBadge>
        </div>
      </div>

      <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
        <span class="inline-flex items-center gap-2">
          <UIcon
            name="i-lucide-ruler"
            class="size-4 shrink-0"
          />{{ formatDistance(route.distance) }}
        </span>
        <span class="inline-flex items-center gap-2">
          <UIcon
            name="i-lucide-trending-up"
            class="size-4 shrink-0"
          />{{ formatElevation(route.elevation) }}
        </span>
      </div>

      <SurfaceBadges :surface="route.surface" />
    </UCard>
  </ULink>
</template>
