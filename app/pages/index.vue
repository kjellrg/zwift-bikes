<script setup lang="ts">
import type { RouteSummary } from '../../shared/types/catalog'

// Without a page-level title the homepage inherits app.vue's bare
// "ZwiftBikes", dropping the "best bike" phrase from the most-indexed page.
const title = 'ZwiftBikes - Find the Best Bike for Any Zwift Route'
useSeoMeta({
  title,
  ogTitle: title
})

// Issue #59: the homepage previously fell back to app.vue's static
// /og-image.png; the generated brand card keeps every share on the same
// visual system as the route/event cards.
defineOgImage('SiteCard', {}, {
  alt: 'ZwiftBikes - find the fastest bike and wheelset for any Zwift route'
})

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
// Two refs per range: the `pending*` one the slider drags against, and the
// committed one the query reads. `useFetch` watches `query` reactively, so a
// slider bound straight into it fires a request per step crossed - up to ~24
// sequential fetches for one drag across the distance scale, each with a
// distinct query string that the 300s cache rule can never serve (issue
// #155). The committed value moves once, on `change` (value-commit, i.e.
// pointer release), which is the same treatment the text search gets from its
// 300ms debounce above. The slider is a controlled `:model-value` rather than
// `v-model` so `resetFilters` can move both halves in one place.
const distanceRange = ref<[number, number]>([0, 120])
const elevationRange = ref<[number, number]>([0, 2000])
const pendingDistanceRange = ref<[number, number]>([...distanceRange.value])
const pendingElevationRange = ref<[number, number]>([...elevationRange.value])
const commitDistanceRange = () => {
  distanceRange.value = [...pendingDistanceRange.value]
}
const commitElevationRange = () => {
  elevationRange.value = [...pendingElevationRange.value]
}
// USlider types its payload for both the single and the range shape; only the
// two-element array is meaningful here, and anything else leaves the drag
// where it is rather than collapsing the range.
const asRange = (value: number[] | number | undefined): [number, number] | undefined =>
  Array.isArray(value) && value.length === 2 ? [value[0]!, value[1]!] : undefined
const onDistanceRangeInput = (value: number[] | number | undefined) => {
  pendingDistanceRange.value = asRange(value) ?? pendingDistanceRange.value
}
const onElevationRangeInput = (value: number[] | number | undefined) => {
  pendingElevationRange.value = asRange(value) ?? pendingElevationRange.value
}
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

// Routes only: segments have their own browsable home at /segments (linked
// from the nav and below the hero), so the old merged routes-and-segments
// mode - and the "Show" kind filter that gated it - is gone. One page per
// content type keeps both lists' filters honest: the distance/elevation/
// surface controls here never applied to segments anyway.
const items = computed<RouteSummary[]>(() => data.value?.routes ?? [])
const visibleItems = computed(() => items.value.slice(0, visibleCount.value))
const isLoading = computed(() => status.value === 'pending')

function resetFilters() {
  search.value = ''
  worldFilter.value = 'all'
  surfaceFilter.value = 'all'
  distanceRange.value = [0, 120]
  elevationRange.value = [0, 2000]
  pendingDistanceRange.value = [...distanceRange.value]
  pendingElevationRange.value = [...elevationRange.value]
}

watch(query, () => {
  visibleCount.value = 24
})

// The filters live in the URL too - `?q=alpe&world=watopia&surface=gravel
// &dist=10-40&elev=0-500` - read once after mount and written from the
// committed values, see `useUrlState`. Ranges are validated as a pair: a
// half-range or an inverted one is ignored rather than guessed at.
const { param, enumParam, replaceQuery } = useUrlState(useRoute(), useRouter())
const rangeParam = (key: string, max: number): [number, number] | undefined => {
  const match = /^(\d+)-(\d+)$/.exec(param(key) ?? '')
  if (!match) return undefined
  const low = Math.min(max, Number(match[1]))
  const high = Math.min(max, Number(match[2]))
  return low <= high ? [low, high] : undefined
}
onMounted(() => {
  const q = param('q')
  if (q) search.value = q.slice(0, 100)
  const world = param('world')
  if (world && /^[a-z0-9-]+$/.test(world)) worldFilter.value = world
  const surface = enumParam('surface', ['gravel', 'cobble'] as const)
  if (surface) surfaceFilter.value = surface
  const dist = rangeParam('dist', 120)
  if (dist) {
    distanceRange.value = dist
    pendingDistanceRange.value = [...dist]
  }
  const elev = rangeParam('elev', 2000)
  if (elev) {
    elevationRange.value = elev
    pendingElevationRange.value = [...elev]
  }
})
watch(query, (value) => {
  const [minD, maxD] = distanceRange.value
  const [minE, maxE] = elevationRange.value
  replaceQuery({
    q: value.search,
    world: value.world,
    surface: value.surface,
    dist: minD > 0 || maxD < 120 ? `${minD}-${maxD}` : undefined,
    elev: minE > 0 || maxE < 2000 ? `${minE}-${maxE}` : undefined
  })
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
        placeholder="Search routes, e.g. Road to Sky, Tick Tock, Volcano Climb..."
        class="w-full"
      />
      <p class="text-sm text-muted">
        Looking for a single climb or sprint? <ULink
          to="/segments"
          class="text-primary underline"
        >Browse all segments</ULink>.
      </p>
    </div>

    <NextRaceCard class="max-w-2xl mx-auto" />

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
      <!-- The h-8 items-center wrapper gives the thin slider track the same
           32px control height as the selects and the Reset button, so the
           row's items-end alignment lines every cell up instead of sinking
           the tracks to the bottom edge. -->
      <div class="min-w-56">
        <label class="block text-xs font-medium text-muted mb-1">
          Distance: {{ pendingDistanceRange[0] }}–{{ pendingDistanceRange[1] }} km
        </label>
        <div class="flex h-8 items-center">
          <USlider
            :model-value="pendingDistanceRange"
            :min="0"
            :max="120"
            :step="5"
            aria-label="Distance range in kilometres"
            @update:model-value="onDistanceRangeInput"
            @change="commitDistanceRange"
          />
        </div>
      </div>
      <div class="min-w-56">
        <label class="block text-xs font-medium text-muted mb-1">
          Elevation: {{ pendingElevationRange[0] }}–{{ pendingElevationRange[1] }} m
        </label>
        <div class="flex h-8 items-center">
          <USlider
            :model-value="pendingElevationRange"
            :min="0"
            :max="2000"
            :step="50"
            aria-label="Elevation range in metres"
            @update:model-value="onElevationRangeInput"
            @change="commitElevationRange"
          />
        </div>
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
        <p
          class="text-sm text-muted"
          aria-live="polite"
        >
          <template v-if="isLoading">
            Finding routes…
          </template>
          <template v-else>
            {{ items.length }} result{{ items.length === 1 ? "" : "s" }} found
          </template>
        </p>
      </div>

      <!-- Skeleton cards in the grid's own shape while loading: the old
           "Loading..." line collapsed the grid to nothing and the stale
           count above it kept quoting the previous filter's total. -->
      <div
        v-if="isLoading"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <RouteCardSkeleton
          v-for="n in 6"
          :key="n"
        />
      </div>

      <div
        v-else-if="items.length === 0"
        class="text-center py-10 text-muted"
      >
        No routes match your filters.
      </div>

      <div
        v-else
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <RouteCard
          v-for="item in visibleItems"
          :key="item.slug"
          :route="item"
        />
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
