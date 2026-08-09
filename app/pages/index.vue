<script setup lang="ts">
import type { RouteSummary } from '../../shared/types/catalog'

const search = ref('')
const searchDebounced = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounced.value = value
  }, 300)
})

const worldFilter = ref<string>('all')
const surfaceFilter = ref<string>('all')
const distanceRange = ref<[number, number]>([0, 120])
const elevationRange = ref<[number, number]>([0, 2000])
const visibleCount = ref(24)

const query = computed(() => ({
  search: searchDebounced.value || undefined,
  // Zwift routes can support running, cycling or both - this site is
  // cycling-specific, so running-only routes are always excluded rather
  // than exposed as a user-facing filter.
  sport: 'cycling',
  world: worldFilter.value !== 'all' ? worldFilter.value : undefined,
  surface: surfaceFilter.value !== 'all' ? surfaceFilter.value : undefined,
  minDistance: distanceRange.value[0] > 0 ? distanceRange.value[0] : undefined,
  maxDistance:
    distanceRange.value[1] < 120 ? distanceRange.value[1] : undefined,
  minElevation:
    elevationRange.value[0] > 0 ? elevationRange.value[0] : undefined,
  maxElevation:
    elevationRange.value[1] < 2000 ? elevationRange.value[1] : undefined
}))

const { data, status } = await useFetch('/api/routes', { query })

const worldOptions = computed(() => [
  { label: 'All worlds', value: 'all' },
  ...(data.value?.worlds ?? []).map(w => ({ label: w.name, value: w.slug }))
])

const surfaceOptions = [
  { label: 'Any surface', value: 'all' },
  { label: 'Includes gravel', value: 'gravel' },
  { label: 'Includes cobbles', value: 'cobble' }
]

const routes = computed<RouteSummary[]>(() => data.value?.routes ?? [])
const visibleRoutes = computed(() => routes.value.slice(0, visibleCount.value))

function resetFilters() {
  search.value = ''
  worldFilter.value = 'all'
  surfaceFilter.value = 'all'
  distanceRange.value = [0, 120]
  elevationRange.value = [0, 2000]
}

watch(query, () => {
  visibleCount.value = 24
})
</script>

<template>
  <UContainer class="py-10 space-y-10">
    <div class="text-center space-y-4 max-w-2xl mx-auto">
      <h1 class="text-3xl sm:text-4xl font-bold text-highlighted">
        Find the best bike for your Zwift route
      </h1>
      <p class="text-muted">
        Pick a route to get a bike &amp; wheel recommendation based on its
        distance, elevation profile and surface (road, gravel or cobbles).
      </p>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        size="xl"
        placeholder="Search routes, e.g. Alpe du Zwift, Tick Tock, Volcano..."
        class="w-full"
      />
    </div>

    <div
      class="flex flex-wrap items-end gap-4 rounded-lg border border-default p-4"
    >
      <div class="min-w-40">
        <label class="block text-xs font-medium text-muted mb-1">World</label>
        <USelectMenu
          v-model="worldFilter"
          value-key="value"
          :items="worldOptions"
          :search-input="false"
          class="w-44"
        />
      </div>
      <div class="min-w-40">
        <label class="block text-xs font-medium text-muted mb-1">Surface</label>
        <USelectMenu
          v-model="surfaceFilter"
          value-key="value"
          :items="surfaceOptions"
          :search-input="false"
          class="w-44"
        />
      </div>
      <div class="min-w-56">
        <label class="block text-xs font-medium text-muted mb-1">
          Distance: {{ distanceRange[0] }}–{{ distanceRange[1] }} km
        </label>
        <USlider
          v-model="distanceRange"
          :min="0"
          :max="120"
          :step="5"
        />
      </div>
      <div class="min-w-56">
        <label class="block text-xs font-medium text-muted mb-1">
          Elevation: {{ elevationRange[0] }}–{{ elevationRange[1] }} m
        </label>
        <USlider
          v-model="elevationRange"
          :min="0"
          :max="2000"
          :step="50"
        />
      </div>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-rotate-ccw"
        @click="resetFilters"
      >
        Reset
      </UButton>
    </div>

    <div>
      <div class="flex items-center justify-between mb-4">
        <p class="text-sm text-muted">
          {{ routes.length }} route{{ routes.length === 1 ? "" : "s" }} found
        </p>
      </div>

      <div
        v-if="status === 'pending'"
        class="text-center py-10 text-muted"
      >
        Loading routes...
      </div>

      <div
        v-else-if="routes.length === 0"
        class="text-center py-10 text-muted"
      >
        No routes match your filters.
      </div>

      <div
        v-else
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <RouteCard
          v-for="route in visibleRoutes"
          :key="route.slug"
          :route="route"
        />
      </div>

      <div
        v-if="visibleCount < routes.length"
        class="text-center mt-6"
      >
        <UButton
          color="neutral"
          variant="subtle"
          @click="visibleCount += 24"
        >
          Show more ({{ routes.length - visibleCount }} remaining)
        </UButton>
      </div>
    </div>
  </UContainer>
</template>
