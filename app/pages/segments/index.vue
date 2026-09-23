<script setup lang="ts">
import type { SegmentSummary } from '../../../shared/types/catalog'

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

// Fetched rather than imported: `getAllSegmentSummaries()` chains through
// `getRoutesWithMeta()` into the 2.1 MB generated surface data, which a
// direct import would drag into the client bundle. The endpoint is cached
// (see the /api/segments route rule), filters server-side, and the
// prerender pass runs with the empty default query - so the static HTML
// always carries the complete catalog.
const segmentQuery = computed(() => ({
  search: searchDebounced.value || undefined,
  world: worldFilter.value !== 'all' ? worldFilter.value : undefined
}))
const { data, status, refresh } = await useFetch('/api/segments', { query: segmentQuery })

// Nuxt resets `data` to its default when a fetch throws, which would empty
// the world groups under the very notice that says the previous segments are
// still shown (`DiscoveryStatus`). So the last catalog served stays the one
// on screen - and the world options with it - until a response replaces it,
// the same bargain the homepage and `useRecommendRequest` strike. A computed
// rather than a watcher because no watcher runs after setup on the server,
// where this page reads the list straight after awaiting the fetch.
let lastServed: typeof data.value
const served = computed(() => {
  if (data.value) lastServed = data.value
  return lastServed
})
const segments = computed<SegmentSummary[]>(() => served.value?.segments ?? [])

const worldOptions = computed(() => [
  { label: 'All worlds', value: 'all' },
  ...(served.value?.worlds ?? []).map(w => ({ label: w.name, value: w.slug }))
])

const typeFilter = ref<'all' | 'climb' | 'sprint'>('all')
const typeOptions = [
  { label: 'Climbs & sprints', value: 'all' },
  { label: 'Climbs', value: 'climb' },
  { label: 'Sprints', value: 'sprint' }
]

function resetFilters() {
  search.value = ''
  worldFilter.value = 'all'
  typeFilter.value = 'all'
}

// The filters live in the URL too - `?q=temple&world=makuri-islands&kind=climb`
// - read once after mount and written from the committed values, exactly as
// the homepage does; see `useUrlState` for why the read never runs during
// render. `kind` is the URL's name for the "Show" filter, which the rest of
// this page calls the segment's type.
const { enumParam, searchParam, slugParam, replaceQuery } = useUrlState(useRoute(), useRouter())
onMounted(() => {
  const q = searchParam('q')
  if (q) search.value = q
  const world = slugParam('world')
  if (world) worldFilter.value = world
  const kind = enumParam('kind', ['climb', 'sprint'] as const)
  if (kind) typeFilter.value = kind
})
watch([searchDebounced, worldFilter, typeFilter], () => {
  replaceQuery({
    q: searchDebounced.value || undefined,
    world: worldFilter.value !== 'all' ? worldFilter.value : undefined,
    kind: typeFilter.value !== 'all' ? typeFilter.value : undefined
  })
})

const countLine = computed(() => discoveryCountLine(shownCounts.value))

const climbCount = computed(() => segments.value.filter(s => s.type === 'climb').length)
const sprintCount = computed(() => segments.value.filter(s => s.type === 'sprint').length)

// "12 climbs and 4 sprints found", narrowing to one noun when the Show
// filter does. A zero is still reported: that a search matched climbs but no
// sprints is what a rider is asking when they search both.
const shownCounts = computed(() => [
  ...(typeFilter.value === 'sprint' ? [] : [{ value: climbCount.value, noun: 'climb' }]),
  ...(typeFilter.value === 'climb' ? [] : [{ value: sprintCount.value, noun: 'sprint' }])
])

// Whole-catalog counts, snapshotted at setup: on the prerender pass the
// query above is the empty default, so these are the full 43/61 - and they
// must not shrink when a visitor filters, since the intro sentence and the
// meta description describe the catalog, not the current result set.
const catalogClimbs = climbCount.value
const catalogSprints = sprintCount.value

// Grouped by world, biggest catalog first; segments inside a group keep the
// endpoint's name order. Groups a filter empties are dropped entirely - a
// world heading with nothing under it reads as broken.
const worldGroups = computed(() => {
  const groups = new Map<string, { worldName: string, segments: SegmentSummary[] }>()
  for (const segment of segments.value) {
    if (typeFilter.value !== 'all' && segment.type !== typeFilter.value) continue
    const group = groups.get(segment.world) ?? { worldName: segment.worldName, segments: [] }
    group.segments.push(segment)
    groups.set(segment.world, group)
  }
  return [...groups.entries()]
    .map(([world, group]) => ({ world, ...group }))
    .sort((a, b) => b.segments.length - a.segments.length || a.worldName.localeCompare(b.worldName))
})

const description = catalogClimbs
  ? `The fastest bike and wheel combo for every rankable Zwift segment - ${catalogClimbs} climbs and ${catalogSprints} sprints, ranked by predicted time for your rider profile.`
  : 'The fastest bike and wheel combo for every rankable Zwift climb and sprint, ranked by predicted time for your rider profile.'

useSeoMeta({
  title: 'The fastest bike for every Zwift climb and sprint | ZwiftBikes',
  description,
  ogTitle: 'Zwift climbs & sprints',
  ogDescription: description
})
defineOgImage('SiteCard', {}, { alt: 'ZwiftBikes - best bike and wheelset for every Zwift climb and sprint' })

const siteConfig = useSiteConfig()
useHead({
  script: [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
        { '@type': 'ListItem', 'position': 2, 'name': 'Segments', 'item': `${siteConfig.url}/segments` }
      ]
    }).replace(/</g, '\\u003c')
  }]
})
</script>

<template>
  <UContainer class="pb-8">
    <div class="pt-8 sm:pt-12">
      <nav aria-label="Breadcrumb">
        <ol class="flex flex-wrap gap-x-3.5 text-sm text-muted">
          <li>
            <NuxtLink
              to="/"
              class="hover:text-highlighted"
            >
              All routes
            </NuxtLink>
          </li>
          <li>Segments</li>
        </ol>
      </nav>
      <h1 class="mt-3 text-balance text-[clamp(2.25rem,6vw,3.75rem)] leading-none font-bold font-display tracking-[-0.01em] text-highlighted">
        The fastest bike for every climb and sprint
      </h1>
      <p class="mt-4 max-w-2xl text-lg text-toned">
        Every rankable segment in Zwift - {{ catalogClimbs }} climbs and {{ catalogSprints }} sprints - with the bike and wheel combo our physics model predicts fastest for each one, at your own weight, height and power once you set a rider profile.
      </p>
    </div>

    <div
      class="mt-8 flex flex-wrap items-end gap-x-6 gap-y-4 border-y border-default py-4"
      role="group"
      aria-label="Segment filters"
    >
      <div class="w-full sm:w-72">
        <label class="mb-1 block text-xs text-muted">Search</label>
        <UInput
          v-model="search"
          icon="i-lucide-search"
          aria-label="Search segments"
          placeholder="e.g. Alpe du Zwift, Fuego Flats"
          class="w-full"
        />
      </div>
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
        <label class="mb-1 block text-xs text-muted">Show</label>
        <USelectMenu
          v-model="typeFilter"
          value-key="value"
          :items="typeOptions"
          :search-input="false"
          aria-label="Show"
          class="w-48"
        />
      </div>
      <div class="flex items-center gap-3 lg:ml-auto">
        <p
          class="text-sm text-muted"
          aria-live="polite"
        >
          <template v-if="status === 'pending'">
            Finding segments…
          </template>
          <template v-else-if="status !== 'error'">
            {{ countLine }}
          </template>
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

    <!-- Skeletons load into a flat grid rather than under headings: which
         worlds have anything in them is exactly what the pending response is
         about to say. -->
    <DiscoveryStatus
      class="mt-6"
      subject="segments"
      :counts="shownCounts"
      :status="status"
      count-elsewhere
      @retry="refresh"
    >
      <template #skeleton>
        <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <SegmentCardSkeleton
            v-for="n in 8"
            :key="n"
          />
        </div>
      </template>

      <div class="space-y-10">
        <section
          v-for="group in worldGroups"
          :key="group.world"
          :aria-labelledby="`world-${group.world}`"
        >
          <h2
            :id="`world-${group.world}`"
            class="text-2xl font-semibold font-heading text-highlighted"
          >
            {{ group.worldName }}
          </h2>
          <ul class="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <li
              v-for="segment in group.segments"
              :key="segment.slug"
            >
              <SegmentCard :segment="segment" />
            </li>
          </ul>
        </section>
      </div>
    </DiscoveryStatus>
  </UContainer>
</template>
