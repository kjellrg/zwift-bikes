<script setup lang="ts">
import type { RouteSummary, RouteWithMeta } from '../../shared/types/catalog'
import { routeSilhouette } from '#shared/utils/silhouette'
import { relatedRoutes } from '../utils/relatedRoutes'

/**
 * Four routes to move on to from a route page, each drawn as its
 * Silhouette - the same world's nearest in climb ratio and distance, filled
 * from other worlds when the world is small (see `relatedRoutes`).
 *
 * Server-rendered, so the links are in the prerendered page a crawler reads.
 * The catalog listing it picks from is large; the `transform` runs where the
 * fetch does, so the page's payload carries only the four cards, never the
 * listing. The host keys this component by route, so a route-to-route
 * navigation fetches the next route's four afresh.
 */
const props = defineProps<{ route: RouteWithMeta }>()

/** Enough points for a card's outline; a listing never needs the measured detail. */
const CARD_SAMPLES = 48

const { data: cards } = await useFetch('/api/routes', {
  key: `related-routes-${props.route.slug}`,
  query: { sport: 'cycling' },
  transform: response => relatedRoutes(props.route, response.routes).map(({ route, otherWorld }: { route: RouteSummary, otherWorld: boolean }) => ({
    slug: route.slug,
    name: route.name,
    worldName: route.worldName,
    distance: route.distance,
    elevation: route.elevation,
    terrain: TERRAIN_LABELS[route.terrain.category],
    otherWorld,
    shape: routeSilhouette(route, 1, { samples: CARD_SAMPLES })
  }))
})

const heading = computed(() => cards.value?.every(card => !card.otherWorld)
  ? `Similar rides in ${props.route.worldName}`
  : 'Similar rides')
</script>

<template>
  <section
    v-if="cards?.length"
    aria-labelledby="related-routes-heading"
  >
    <h2
      id="related-routes-heading"
      class="text-2xl font-semibold font-heading text-highlighted"
    >
      {{ heading }}
    </h2>
    <ul class="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      <li
        v-for="card in cards"
        :key="card.slug"
      >
        <NuxtLink
          :to="`/routes/${card.slug}`"
          class="block h-full rounded-lg border border-default bg-elevated px-4 pt-3.5 pb-3 transition-colors hover:border-accented"
        >
          <RouteSilhouette
            :shape="card.shape"
            class="mb-2 h-11"
          />
          <span class="block font-semibold text-highlighted">{{ card.name }}</span>
          <span class="mt-0.5 block text-sm text-muted">
            {{ formatDistance(card.distance) }} · {{ formatElevation(card.elevation) }} · {{ card.terrain }}<template v-if="card.otherWorld">
              · {{ card.worldName }}
            </template>
          </span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
