<script setup lang="ts">
import type { RouteWithMeta } from '../../shared/types/catalog'
import type { RouteTotals } from '../../shared/utils/routeLaps'
import type { RouteClimbOccurrence } from '../../shared/utils/routeOccurrences'

/**
 * The compact course briefing beside the recommendation: terrain, what the
 * model knows about the course (elevation profile, surface positions), the
 * surfaces by name, the mapped climbs and the lap/lead-in scope. Everything
 * here is a property of the Ride alone, so it renders with zero equipment
 * matches and during a refetch - the deeper, equipment-dependent analysis
 * (speed chart, TTT plan) lives in the course panels below the answer.
 * Percentages and Crr stay in those panels too: at a glance a rider wants
 * "Tarmac / Cobbles / Wood", not three decimals.
 */
const props = defineProps<{
  route: RouteWithMeta
  /** The lap count the totals and occurrences below describe. */
  laps: number
  totals: RouteTotals
  /** Already lap-expanded by the page, so the count and first occurrence agree with the climbs card and the elevation chart. */
  climbs: RouteClimbOccurrence[]
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
      {{ TERRAIN_LABELS[route.terrain.category] }}
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
        {{ surfaceNames }} (lap)
      </li>
      <li v-if="climbs[0]">
        {{ climbs.length }} mapped climb occurrence{{ climbs.length === 1 ? '' : 's' }}. First: {{ climbs[0].name }} at km {{ climbs[0].rideFromKm.toFixed(1) }}.
      </li>
      <li v-else>
        No mapped climbs on this ride.
      </li>
      <li>
        {{ laps }} lap{{ laps === 1 ? '' : 's' }}<template v-if="totals.leadInDistanceKm > 0">
          + {{ formatDistance(totals.leadInDistanceKm) }} lead-in<template v-if="totals.leadInElevationM > 0">
            / {{ formatElevation(totals.leadInElevationM) }}
          </template>, ridden once
        </template>
      </li>
    </ul>
    <slot />
  </section>
</template>
