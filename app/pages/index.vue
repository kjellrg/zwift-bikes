<script setup lang="ts">
import type { RouteSummary, SegmentSummary } from '../../shared/types/catalog'

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
// Defaults to routes-only, matching today's behavior - segments are opt-in.
const kindFilter = ref<'routes' | 'segments' | 'both'>('routes')

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

// Fetched unconditionally alongside routes (segments are a small list, ~70
// entries) so the filter toggle below is instant - only whether they're
// merged into `items` depends on `kindFilter`, not whether this request runs.
const segmentQuery = computed(() => ({
  search: searchDebounced.value || undefined,
  world: worldFilter.value !== 'all' ? worldFilter.value : undefined
}))
const { data: segmentData, status: segmentStatus } = await useFetch('/api/segments', { query: segmentQuery })

const worldOptions = computed(() => [
  { label: 'All worlds', value: 'all' },
  ...(data.value?.worlds ?? []).map(w => ({ label: w.name, value: w.slug }))
])

const surfaceOptions = [
  { label: 'Any surface', value: 'all' },
  { label: 'Includes gravel', value: 'gravel' },
  { label: 'Includes cobbles', value: 'cobble' }
]

const kindOptions = [
  { label: 'Routes', value: 'routes' },
  { label: 'Segments', value: 'segments' },
  { label: 'Routes & segments', value: 'both' }
]

const routes = computed<RouteSummary[]>(() => data.value?.routes ?? [])
const segments = computed<SegmentSummary[]>(() => segmentData.value?.segments ?? [])

type BrowseItem = { kind: 'route', slug: string, name: string, route: RouteSummary } | { kind: 'segment', slug: string, name: string, segment: SegmentSummary }

const items = computed<BrowseItem[]>(() => {
  const result: BrowseItem[] = []
  if (kindFilter.value !== 'segments') result.push(...routes.value.map(route => ({ kind: 'route' as const, slug: route.slug, name: route.name, route })))
  if (kindFilter.value !== 'routes') result.push(...segments.value.map(segment => ({ kind: 'segment' as const, slug: segment.slug, name: segment.name, segment })))
  return result.sort((a, b) => a.name.localeCompare(b.name))
})
const visibleItems = computed(() => items.value.slice(0, visibleCount.value))
const isLoading = computed(() => status.value === 'pending' || (kindFilter.value !== 'routes' && segmentStatus.value === 'pending'))

function resetFilters() {
  search.value = ''
  worldFilter.value = 'all'
  surfaceFilter.value = 'all'
  distanceRange.value = [0, 120]
  elevationRange.value = [0, 2000]
  kindFilter.value = 'routes'
}

watch([query, kindFilter], () => {
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
      <div class="min-w-40">
        <label class="block text-xs font-medium text-muted mb-1">Show</label>
        <USelectMenu
          v-model="kindFilter"
          value-key="value"
          :items="kindOptions"
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
          {{ items.length }} result{{ items.length === 1 ? "" : "s" }} found
        </p>
      </div>

      <div
        v-if="isLoading"
        class="text-center py-10 text-muted"
      >
        Loading...
      </div>

      <div
        v-else-if="items.length === 0"
        class="text-center py-10 text-muted"
      >
        No routes or segments match your filters.
      </div>

      <div
        v-else
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <template
          v-for="item in visibleItems"
          :key="`${item.kind}-${item.slug}`"
        >
          <RouteCard
            v-if="item.kind === 'route'"
            :route="item.route"
          />
          <SegmentCard
            v-else
            :segment="item.segment"
          />
        </template>
      </div>

      <div
        v-if="visibleCount < items.length"
        class="text-center mt-6"
      >
        <UButton
          color="neutral"
          variant="subtle"
          @click="visibleCount += 24"
        >
          Show more ({{ items.length - visibleCount }} remaining)
        </UButton>
      </div>
    </div>
  </UContainer>
</template>
