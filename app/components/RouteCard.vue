<script setup lang="ts">
import type { RouteCardData } from '#shared/utils/routeCards'

/**
 * A route as the homepage lists it: its Silhouette and surface strip first,
 * so terrain reads before any number, then its name, and at the foot its
 * world and terrain over the numbers a rider picks a route by - distance,
 * climbing, climb ratio - as plain text. Terrain is a word, "Event only" a
 * small text tag: nothing on a card is a coloured badge.
 *
 * The name has the card's whole width and wraps; the foot is pinned to the
 * bottom, so the cards in a grid row line their numbers up whichever name
 * took two lines.
 */
defineProps<{
  route: RouteCardData
}>()
</script>

<template>
  <NuxtLink
    :to="`/routes/${route.slug}`"
    class="flex h-full flex-col rounded-xl border border-default bg-elevated px-4 pt-3.5 pb-3.5 transition-colors hover:border-accented"
  >
    <RouteSilhouette
      :shape="route.shape"
      strip
      class="h-14"
    />
    <h3 class="mt-3 font-semibold text-balance text-highlighted">
      {{ route.name }}
    </h3>
    <span class="mt-auto block pt-1.5">
      <span class="flex items-baseline justify-between gap-2 text-sm text-muted">
        <span class="min-w-0">{{ route.worldName }} · {{ TERRAIN_LABELS[route.terrain] }}</span>
        <span
          v-if="route.eventOnly"
          class="shrink-0 text-xs"
        >Event only</span>
      </span>
      <span class="mt-0.5 flex flex-wrap gap-x-3 text-sm text-toned">
        <span><span class="font-semibold text-highlighted">{{ route.distance.toFixed(1) }}</span> km</span>
        <span><span class="font-semibold text-highlighted">{{ Math.round(route.elevation) }}</span> m</span>
        <span>{{ route.climbRatio.toFixed(1) }} m/km</span>
      </span>
    </span>
  </NuxtLink>
</template>
