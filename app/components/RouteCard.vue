<script setup lang="ts">
import type { RouteSummary } from '../../shared/types/catalog'

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
        <div>
          <p class="font-semibold text-highlighted">
            {{ route.name }}
          </p>
          <p class="text-sm text-muted">
            {{ route.worldName }}
          </p>
        </div>
        <div class="flex flex-col items-end gap-1.5">
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

      <div class="flex flex-wrap gap-4 text-sm">
        <span class="inline-flex items-center gap-1.5">
          <UIcon
            name="i-lucide-ruler"
            class="size-4 text-muted"
          />
          {{ formatDistance(route.distance) }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <UIcon
            name="i-lucide-trending-up"
            class="size-4 text-muted"
          />
          {{ formatElevation(route.elevation) }}
        </span>
      </div>

      <SurfaceBadges :surface="route.surface" />
    </UCard>
  </ULink>
</template>
