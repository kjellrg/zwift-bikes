<script setup lang="ts">
import type { RouteWithMeta } from '../../shared/types/catalog'
import type { RelatedRouteCardData } from '#shared/utils/routeCards'

/**
 * Four routes to move on to from a route page, each drawn as its
 * Silhouette - the same world's nearest in climb ratio and distance, filled
 * from other worlds when the world is small (see `relatedRoutes`).
 *
 * Server-rendered, so the links are in the prerendered page a crawler reads.
 * The server picks the four (`/api/route-cards?relatedTo=`), so the page's
 * payload carries only their cards and never the catalog listing. The host
 * keys this component by route, so a route-to-route navigation fetches the
 * next route's four afresh.
 */
const props = defineProps<{ route: RouteWithMeta }>()

const { data } = await useFetch<{ cards: RelatedRouteCardData[] }>('/api/route-cards', {
  key: `related-routes-${props.route.slug}`,
  query: { relatedTo: props.route.slug }
})
const cards = computed(() => data.value?.cards)

// "Similar rides in Watopia" when all four are the route's own world, with
// the world's name a link to its World page (#58): the heading names the
// world, and wherever the site names a world the name leads to its page.
// Filled from other worlds, the heading names none.
const sameWorld = computed(() => Boolean(cards.value?.every(card => !card.otherWorld)))
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
      <template v-if="sameWorld">
        Similar rides in <NuxtLink
          :to="`/worlds/${route.world}`"
          class="underline decoration-rule-strong underline-offset-4 hover:decoration-current"
        >{{ route.worldName }}</NuxtLink>
      </template>
      <template v-else>
        Similar rides
      </template>
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
            {{ formatDistance(card.distance) }} · {{ formatElevation(card.elevation) }} · {{ TERRAIN_LABELS[card.terrain] }}<template v-if="card.otherWorld">
              · {{ card.worldName }}
            </template>
          </span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
