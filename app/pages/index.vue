<script setup lang="ts">
import type { TerrainCategory } from '../../shared/types/catalog'
import type { RouteCardData } from '#shared/utils/routeCards'
import { filterRouteCards, ROUTE_DISTANCE_MAX_KM, ROUTE_ELEVATION_MAX_M } from '../utils/routeCardFilters'

// Without a page-level title the homepage inherits app.vue's bare
// "ZwiftBikes", dropping the "best bike" phrase from the most-indexed page.
const title = 'The fastest bike for any Zwift route | ZwiftBikes'
useSeoMeta({
  title,
  description: 'Find the best bike and wheelset for any Zwift route: every frame and wheel in the game ridden over the route\'s real elevation and surfaces, at your weight and power, and ranked by finish time.',
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
const surfaceFilter = ref<'all' | 'gravel' | 'cobble'>('all')
// Two refs per range: the `pending*` one the slider drags against, and the
// committed one the list and the URL read. The committed value moves once, on
// `change` (value-commit, i.e. pointer release), the same treatment the text
// search gets from its 300ms debounce above: the grid and the count settle on
// what the rider chose rather than reshuffling under every step of a drag
// (issue #155, when each step was a request). The slider is a controlled
// `:model-value` rather than `v-model` so `resetFilters` can move both halves
// in one place.
const distanceRange = ref<[number, number]>([0, ROUTE_DISTANCE_MAX_KM])
const elevationRange = ref<[number, number]>([0, ROUTE_ELEVATION_MAX_M])
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

// Every cycling route's card, once (#262): the prerendered payload carries
// them all - 48 heights and a few surface spans each - and every filter below
// works over that list in the browser, so a filter change makes no request
// and draws no geometry. Should the catalog outgrow the payload budget
// (`server/utils/routeCardCatalog.test.ts`), the fallback is filtering and paging on
// the server.
const { data } = await useFetch<{ cards: RouteCardData[], worlds: { slug: string, name: string }[] }>('/api/route-cards', { key: 'route-cards' })
const allCards = computed(() => data.value?.cards ?? [])

const worldOptions = computed(() => [
  { label: 'All worlds', value: 'all' },
  // The game's own order, Watopia first, as the segments page lists them.
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
const TERRAIN_CHIPS: { value: TerrainCategory, label: string }[] = (['flat', 'rolling', 'hilly', 'mountainous'] as const)
  .map(value => ({ value, label: TERRAIN_LABELS[value] }))
const terrainFilter = ref<TerrainCategory[]>([])
function toggleTerrain(value: TerrainCategory) {
  terrainFilter.value = terrainFilter.value.includes(value)
    ? terrainFilter.value.filter(entry => entry !== value)
    : [...terrainFilter.value, value]
}
const filters = computed(() => ({
  search: searchDebounced.value,
  world: worldFilter.value !== 'all' ? worldFilter.value : undefined,
  surface: surfaceFilter.value !== 'all' ? surfaceFilter.value : undefined,
  distance: distanceRange.value,
  elevation: elevationRange.value,
  terrain: terrainFilter.value
}))
const items = computed<RouteCardData[]>(() => filterRouteCards(allCards.value, filters.value))
const visibleItems = computed(() => items.value.slice(0, visibleCount.value))
// Routes are the only thing counted here, so the line reads "24 routes
// found" - the segments page counts climbs and sprints separately.
const resultCounts = computed(() => [{ value: items.value.length, noun: 'route' }])
const countLine = computed(() => discoveryCountLine(resultCounts.value))

// Whose rider the times on the site are for, under the search - the default
// is never silent. Read after mount like everything stored.
const { weightKg, powerW, hasStoredProfile, load: loadRiderProfile } = useRiderProfile()
const { openProfile } = useOverlays()
onMounted(loadRiderProfile)

function resetFilters() {
  // The debounce is for typing; a reset shows the whole catalog at once.
  clearTimeout(searchDebounceTimer)
  search.value = ''
  searchDebounced.value = ''
  worldFilter.value = 'all'
  surfaceFilter.value = 'all'
  terrainFilter.value = []
  distanceRange.value = [0, ROUTE_DISTANCE_MAX_KM]
  elevationRange.value = [0, ROUTE_ELEVATION_MAX_M]
  pendingDistanceRange.value = [...distanceRange.value]
  pendingElevationRange.value = [...elevationRange.value]
}

watch(filters, () => {
  visibleCount.value = 24
})

// The filters live in the URL too - `?q=alpe&world=watopia&surface=gravel
// &dist=10-40&elev=0-500` - read once after mount and written from the
// committed values, see `useUrlState`. Ranges are validated as a pair: a
// half-range or an inverted one is ignored rather than guessed at.
const { param, enumParam, searchParam, slugParam, replaceQuery } = useUrlState(useRoute(), useRouter())
const rangeParam = (key: string, max: number): [number, number] | undefined => {
  const match = /^(\d+)-(\d+)$/.exec(param(key) ?? '')
  if (!match) return undefined
  const low = Math.min(max, Number(match[1]))
  const high = Math.min(max, Number(match[2]))
  return low <= high ? [low, high] : undefined
}
onMounted(() => {
  const q = searchParam('q')
  if (q) search.value = q
  const world = slugParam('world')
  if (world) worldFilter.value = world
  const surface = enumParam('surface', ['gravel', 'cobble'] as const)
  if (surface) surfaceFilter.value = surface
  const terrain = (param('terrain') ?? '').split(',').filter((value): value is TerrainCategory => TERRAIN_CHIPS.some(chip => chip.value === value))
  if (terrain.length) terrainFilter.value = [...new Set(terrain)]
  const dist = rangeParam('dist', ROUTE_DISTANCE_MAX_KM)
  if (dist) {
    distanceRange.value = dist
    pendingDistanceRange.value = [...dist]
  }
  const elev = rangeParam('elev', ROUTE_ELEVATION_MAX_M)
  if (elev) {
    elevationRange.value = elev
    pendingElevationRange.value = [...elev]
  }
})
watch(filters, (value) => {
  const [minD, maxD] = value.distance
  const [minE, maxE] = value.elevation
  replaceQuery({
    q: value.search || undefined,
    world: value.world,
    surface: value.surface,
    terrain: value.terrain.length ? TERRAIN_CHIPS.map(chip => chip.value).filter(entry => value.terrain.includes(entry)).join(',') : undefined,
    dist: minD > 0 || maxD < ROUTE_DISTANCE_MAX_KM ? `${minD}-${maxD}` : undefined,
    elev: minE > 0 || maxE < ROUTE_ELEVATION_MAX_M ? `${minE}-${maxE}` : undefined
  })
})
</script>

<template>
  <UContainer class="pb-8">
    <div class="grid grid-cols-1 items-center gap-8 pt-10 pb-5 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-14 lg:pt-16 lg:pb-7">
      <div>
        <h1 class="text-balance text-[clamp(2.5rem,6.2vw,4.25rem)] leading-[0.98] font-bold font-display tracking-[-0.01em] text-highlighted">
          The fastest bike for any Zwift route
        </h1>
        <p class="mt-4 max-w-[46ch] text-lg text-toned">
          Pick a route. ZwiftBikes rides every frame and wheelset in the game over its real elevation and surfaces, at your weight and power, and ranks them by finish time.
        </p>
        <UInput
          v-model="search"
          icon="i-lucide-search"
          size="xl"
          aria-label="Search routes"
          placeholder="Route name, e.g. Road to Sky"
          class="mt-6 w-full max-w-xl"
        />
        <p class="mt-3.5 text-sm text-muted">
          <template v-if="hasStoredProfile">
            Times are for you, {{ weightKg }} kg at {{ powerW }} W.
            <a
              href="/profile"
              aria-haspopup="dialog"
              class="text-primary underline decoration-primary/40 hover:decoration-primary"
              @click="openProfile"
            >Edit your profile</a>
          </template>
          <template v-else>
            Times are for the default rider, {{ weightKg }} kg at {{ powerW }} W.
            <a
              href="/profile"
              aria-haspopup="dialog"
              class="text-primary underline decoration-primary/40 hover:decoration-primary"
              @click="openProfile"
            >Set your profile</a>
            and every page uses yours.
          </template>
        </p>
      </div>
      <HomeExample />
    </div>

    <section
      aria-labelledby="route-finder-heading"
      class="mt-12"
    >
      <h2
        id="route-finder-heading"
        class="text-2xl font-semibold font-heading text-highlighted"
      >
        Every route, by its shape
      </h2>
      <p class="mt-1 text-sm text-muted">
        Each card draws the route's elevation profile, so you can pick by terrain before you read a number.
      </p>

      <!-- Two rows, one question each: what kind of route (world, terrain,
           surface), then how big (distance, elevation), with the count and
           Reset closing the second row as they close the segments page's.
           One wrapping row put the elevation slider alone under the world
           select at desktop widths. -->
      <div
        class="mt-4 space-y-4 border-y border-default py-4"
        role="group"
        aria-label="Route filters"
      >
        <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div>
            <label class="mb-1 block text-xs text-muted">World</label>
            <USelectMenu
              v-model="worldFilter"
              value-key="value"
              :items="worldOptions"
              :search-input="false"
              aria-label="World"
              class="w-44"
            />
          </div>
          <div>
            <p class="mb-1 text-xs text-muted">
              Terrain
            </p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="chip in TERRAIN_CHIPS"
                :key="chip.value"
                type="button"
                class="rounded-full border px-3 py-1 text-sm transition-colors"
                :class="terrainFilter.includes(chip.value) ? 'border-ink bg-accented text-highlighted' : 'border-accented bg-elevated text-toned hover:text-highlighted'"
                :aria-pressed="terrainFilter.includes(chip.value)"
                @click="toggleTerrain(chip.value)"
              >
                {{ chip.label }}
              </button>
            </div>
          </div>
          <div>
            <label class="mb-1 block text-xs text-muted">Surface</label>
            <USelectMenu
              v-model="surfaceFilter"
              value-key="value"
              :items="surfaceOptions"
              :search-input="false"
              aria-label="Surface"
              class="w-44"
            />
          </div>
        </div>
        <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
          <!-- The h-8 wrapper gives the thin slider track the same 32px control
             height as the selects, so the row's items-end alignment lines every
             cell up. -->
          <div class="w-full sm:w-52">
            <label class="mb-1 block text-xs text-muted">
              Distance {{ pendingDistanceRange[0] }}–{{ pendingDistanceRange[1] }} km
            </label>
            <div class="flex h-8 items-center">
              <USlider
                :model-value="pendingDistanceRange"
                :min="0"
                :max="ROUTE_DISTANCE_MAX_KM"
                :step="5"
                size="sm"
                aria-label="Distance range in kilometres"
                @update:model-value="onDistanceRangeInput"
                @change="commitDistanceRange"
              />
            </div>
          </div>
          <div class="w-full sm:w-52">
            <label class="mb-1 block text-xs text-muted">
              Elevation {{ pendingElevationRange[0] }}–{{ pendingElevationRange[1] }} m
            </label>
            <div class="flex h-8 items-center">
              <USlider
                :model-value="pendingElevationRange"
                :min="0"
                :max="ROUTE_ELEVATION_MAX_M"
                :step="50"
                size="sm"
                aria-label="Elevation range in metres"
                @update:model-value="onElevationRangeInput"
                @change="commitElevationRange"
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
              @click="resetFilters"
            >
              Reset
            </UButton>
          </div>
        </div>
      </div>

      <DiscoveryStatus
        class="mt-5"
        subject="routes"
        :counts="resultCounts"
        count-elsewhere
      >
        <div class="space-y-6">
          <ul class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <li
              v-for="item in visibleItems"
              :key="item.slug"
            >
              <RouteCard :route="item" />
            </li>
          </ul>

          <div
            v-if="visibleCount < items.length"
            class="text-center"
          >
            <UButton
              color="neutral"
              variant="outline"
              @click="visibleCount += 24"
            >
              Show more ({{ items.length - visibleCount }} remaining)
            </UButton>
          </div>
        </div>
      </DiscoveryStatus>
    </section>

    <div class="mt-12 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-default bg-elevated px-6 py-5">
      <h2 class="text-xl font-semibold font-heading text-highlighted">
        After one climb or sprint?
      </h2>
      <p class="text-toned">
        Every named segment has its own ranking, timed at your climbing or sprint power.
      </p>
      <NuxtLink
        to="/segments"
        class="font-medium text-primary hover:underline sm:ml-auto"
      >
        Browse segments
      </NuxtLink>
    </div>
  </UContainer>
</template>
