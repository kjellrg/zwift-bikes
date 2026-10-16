<script setup lang="ts">
import { ROUTE_SURFACE_WORDS } from '#shared/utils/routeCards'
import { TERRAIN_FILTER_VALUES, type RouteFilters } from '../composables/useRouteFilters'
import { ROUTE_DISTANCE_MAX_KM, ROUTE_ELEVATION_MAX_M } from '../utils/routeCardFilters'

/**
 * The route filters - world, terrain, surface, distance and elevation - as
 * the homepage and the Standings pages both show them, editing the state a
 * page holds through `useRouteFilters`. The count and Reset close the second
 * row; Reset is the page's, since the homepage's also clears its search.
 */
const props = defineProps<{
  filters: RouteFilters
  /** The worlds, in the game's own order - Watopia first, as the segments page lists them. */
  worlds: readonly { slug: string, name: string }[]
  /** The count line, announced as it changes. */
  countLine: string
}>()

defineEmits<{ reset: [] }>()

const worldOptions = computed(() => [
  { label: 'All worlds', value: 'all' },
  ...props.worlds.map(w => ({ label: w.name, value: w.slug }))
])

const surfaceOptions = [
  { label: 'Any surface', value: 'all' },
  { label: `Includes ${ROUTE_SURFACE_WORDS.gravel}`, value: 'gravel' },
  { label: `Includes ${ROUTE_SURFACE_WORDS.cobble}`, value: 'cobble' }
]

const terrainChips = TERRAIN_FILTER_VALUES.map(value => ({ value, label: TERRAIN_LABELS[value] }))
</script>

<template>
  <!-- Two rows, one question each: what kind of route (world, terrain,
       surface), then how big (distance, elevation), with the count and
       Reset closing the second row as they close the segments page's.
       One wrapping row put the elevation slider alone under the world
       select at desktop widths. -->
  <div
    class="space-y-4 border-y border-default py-4"
    role="group"
    aria-label="Route filters"
  >
    <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div>
        <label class="mb-1 block text-xs text-muted">World</label>
        <USelectMenu
          :model-value="filters.world"
          value-key="value"
          :items="worldOptions"
          :search-input="false"
          aria-label="World"
          class="w-44"
          @update:model-value="filters.setWorld"
        />
      </div>
      <div>
        <p class="mb-1 block text-xs text-muted">
          Terrain
        </p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="chip in terrainChips"
            :key="chip.value"
            type="button"
            class="inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors"
            :class="filters.terrain.includes(chip.value) ? 'border-ink bg-accented text-highlighted' : 'border-accented bg-elevated text-toned hover:text-highlighted'"
            :aria-pressed="filters.terrain.includes(chip.value)"
            @click="filters.toggleTerrain(chip.value)"
          >
            {{ chip.label }}
          </button>
        </div>
      </div>
      <div>
        <label class="mb-1 block text-xs text-muted">Surface</label>
        <USelectMenu
          :model-value="filters.surface"
          value-key="value"
          :items="surfaceOptions"
          :search-input="false"
          aria-label="Surface"
          class="w-44"
          @update:model-value="filters.setSurface"
        />
      </div>
    </div>
    <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
      <!-- The h-8 wrapper gives the thin slider track the same 32px control
         height as the selects, so the row's items-end alignment lines every
         cell up. -->
      <div class="w-full sm:w-52">
        <label class="mb-1 block text-xs text-muted">
          Distance {{ filters.pendingDistance[0] }}–{{ filters.pendingDistance[1] }} km
        </label>
        <div class="flex h-8 items-center">
          <USlider
            :model-value="filters.pendingDistance"
            :min="0"
            :max="ROUTE_DISTANCE_MAX_KM"
            :step="5"
            size="sm"
            aria-label="Distance range in kilometres"
            @update:model-value="filters.onDistanceInput"
            @change="filters.commitDistance"
          />
        </div>
      </div>
      <div class="w-full sm:w-52">
        <label class="mb-1 block text-xs text-muted">
          Elevation {{ filters.pendingElevation[0] }}–{{ filters.pendingElevation[1] }} m
        </label>
        <div class="flex h-8 items-center">
          <USlider
            :model-value="filters.pendingElevation"
            :min="0"
            :max="ROUTE_ELEVATION_MAX_M"
            :step="50"
            size="sm"
            aria-label="Elevation range in metres"
            @update:model-value="filters.onElevationInput"
            @change="filters.commitElevation"
          />
        </div>
      </div>
      <div class="flex items-center gap-3 lg:ml-auto">
        <!-- The count sits with the controls that produced it; the live
           region is always there, so a change is announced. -->
        <p
          class="text-sm text-muted"
          aria-live="polite"
        >
          {{ countLine }}
        </p>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-rotate-ccw"
          @click="$emit('reset')"
        >
          Reset
        </UButton>
      </div>
    </div>
  </div>
</template>
