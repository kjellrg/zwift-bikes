<script setup lang="ts">
import type { RouteWithMeta } from '../../shared/types/catalog'

/**
 * The compact course briefing beside the recommendation: what the ride is,
 * what the model knows about the course (elevation profile, surface
 * positions) and the surfaces by name. Everything here is a property of the
 * Ride alone, so it renders with zero equipment matches and during a refetch
 * - the deeper, equipment-dependent analysis a route page offers (speed
 * chart, TTT plan) lives in the course panels below the answer. Percentages
 * and Crr stay in those panels too: at a glance a rider wants "Tarmac /
 * Cobbles / Wood", not three decimals.
 *
 * The lines that differ between a route and a segment - the mapped climbs
 * and the lap/lead-in scope on one, the timing scope, host routes and
 * placement caveat on the other - come from the page through the default
 * slot, as further `<li>`s of the same list.
 */
const props = defineProps<{
  /** The route, or the synthetic segment-as-route the segment page ranks against. */
  route: RouteWithMeta
  /** The ride in a word or two: the terrain category for a route, "Climbing segment" for a segment. */
  kind: string
  /** Whether the surface mix describes one lap of a repeated course rather than the whole ride - a route, not a segment. */
  perLap?: boolean
}>()

const hasElevationProfile = computed(() => (props.route.terrain.elevationProfile?.length ?? 0) > 1)
const surfaceCoverage = computed(() => surfaceCoverageLine(props.route.surface))
const surfaceNames = computed(() => surfaceNamesLine(props.route.surface.composition))
</script>

<template>
  <section
    aria-labelledby="ride-briefing-heading"
    class="min-w-0"
  >
    <div class="flex items-baseline justify-between gap-4">
      <h2
        id="ride-briefing-heading"
        class="text-xl font-semibold text-highlighted"
      >
        Ride briefing
      </h2>
      <span class="text-sm text-muted">{{ route.worldName }}</span>
    </div>
    <p class="mt-3 text-2xl text-highlighted">
      {{ kind }}
    </p>
    <ul class="mt-4 space-y-2 text-sm text-muted">
      <li class="flex items-center gap-2">
        <UIcon
          :name="hasElevationProfile ? 'i-lucide-chart-no-axes-combined' : 'i-lucide-circle-help'"
          class="size-4 shrink-0"
        />{{ hasElevationProfile ? 'Measured elevation profile' : 'Elevation profile unavailable' }}
      </li>
      <li class="flex items-center gap-2">
        <UIcon
          name="i-lucide-route"
          class="size-4 shrink-0"
        />{{ surfaceCoverage }}
      </li>
      <li v-if="surfaceNames">
        {{ surfaceNames }}<template v-if="perLap">
          (lap)
        </template>
      </li>
      <slot />
    </ul>
  </section>
</template>
