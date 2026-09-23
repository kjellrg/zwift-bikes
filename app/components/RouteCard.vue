<script setup lang="ts">
import type { RouteCardData } from '../utils/routeCards'

/**
 * A route as the homepage lists it: its Silhouette and surface strip first,
 * so terrain reads before any number, then its name and world, and the
 * numbers a rider picks a route by - distance, climbing, climb ratio - as
 * plain text. Terrain is a word, "Event only" a small text tag: nothing on a
 * card is a coloured badge.
 */
defineProps<{
  route: RouteCardData
}>()
</script>

<template>
  <NuxtLink
    :to="`/routes/${route.slug}`"
    class="block h-full rounded-xl border border-default bg-elevated px-4 pt-3.5 pb-3.5 transition-colors hover:border-accented"
  >
    <RouteSilhouette
      :shape="route.shape"
      strip
      class="h-14"
    />
    <span class="mt-3 flex items-baseline justify-between gap-2">
      <h3 class="min-w-0 font-semibold text-highlighted">{{ route.name }}</h3>
      <span class="shrink-0 text-sm text-muted">{{ route.worldName }}</span>
    </span>
    <span class="mt-0.5 flex flex-wrap gap-x-3 text-sm text-toned">
      <span><span class="font-semibold text-highlighted">{{ route.distance.toFixed(1) }}</span> km</span>
      <span><span class="font-semibold text-highlighted">{{ Math.round(route.elevation) }}</span> m</span>
      <span>{{ route.climbRatio.toFixed(1) }} m/km</span>
      <span>{{ TERRAIN_LABELS[route.terrain] }}</span>
      <span
        v-if="route.eventOnly"
        class="ml-auto text-xs text-muted"
      >Event only</span>
    </span>
  </NuxtLink>
</template>
