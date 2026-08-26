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
const { data, status } = await useFetch('/api/segments', { query: segmentQuery })
const segments = computed<SegmentSummary[]>(() => data.value?.segments ?? [])

const worldOptions = computed(() => [
  { label: 'All worlds', value: 'all' },
  ...(data.value?.worlds ?? []).map(w => ({ label: w.name, value: w.slug }))
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

const climbCount = computed(() => segments.value.filter(s => s.type === 'climb').length)
const sprintCount = computed(() => segments.value.filter(s => s.type === 'sprint').length)

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
  title: 'Zwift Climbs & Sprints - Best Bike for Every Segment - ZwiftBikes',
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
  <UContainer class="py-10 space-y-10">
    <div>
      <UButton
        to="/"
        variant="link"
        color="neutral"
        icon="i-lucide-arrow-left"
        class="mb-4 px-0"
      >
        Back to all routes
      </UButton>
      <h1 class="text-3xl font-bold text-highlighted">
        Zwift climbs &amp; sprints
      </h1>
      <p class="text-muted mt-2 max-w-2xl">
        Every rankable segment in Zwift - {{ catalogClimbs }} climbs and {{ catalogSprints }} sprints -
        with the bike and wheel combo our physics model predicts fastest for each one, tuned to
        your own weight, height and power once you set a rider profile.
      </p>
    </div>

    <div class="flex flex-wrap items-end gap-4 rounded-lg border border-default p-4">
      <div class="min-w-56 grow sm:grow-0 sm:w-72">
        <label class="block text-xs font-medium text-muted mb-1">Search</label>
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="e.g. Alpe du Zwift, Fuego Flats..."
          class="w-full"
        />
      </div>
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
        <label class="block text-xs font-medium text-muted mb-1">Show</label>
        <USelectMenu
          v-model="typeFilter"
          value-key="value"
          :items="typeOptions"
          :search-input="false"
          class="w-48"
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

    <p
      v-if="status === 'pending' && !worldGroups.length"
      class="text-muted"
    >
      Loading...
    </p>
    <p
      v-else-if="!worldGroups.length"
      class="text-muted"
    >
      No segments match your filters.
    </p>

    <div
      v-for="group in worldGroups"
      :key="group.world"
      class="space-y-4"
    >
      <h2 class="text-xl font-semibold text-highlighted">
        {{ group.worldName }}
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SegmentCard
          v-for="segment in group.segments"
          :key="segment.slug"
          :segment="segment"
        />
      </div>
    </div>
  </UContainer>
</template>
