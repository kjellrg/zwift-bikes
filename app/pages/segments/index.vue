<script setup lang="ts">
import type { SegmentSummary } from '../../../shared/types/catalog'

// Fetched rather than imported: `getAllSegmentSummaries()` chains through
// `getRoutesWithMeta()` into the 2.1 MB generated surface data, which a
// direct import would drag into the client bundle. The endpoint is cached
// (see the /api/segments route rule) and this page prerenders anyway.
const { data } = await useFetch('/api/segments')
const segments = computed<SegmentSummary[]>(() => data.value?.segments ?? [])

const typeFilter = ref<'all' | 'climb' | 'sprint'>('all')
const typeOptions = [
  { label: 'Climbs & sprints', value: 'all' },
  { label: 'Climbs', value: 'climb' },
  { label: 'Sprints', value: 'sprint' }
]

const climbCount = computed(() => segments.value.filter(s => s.type === 'climb').length)
const sprintCount = computed(() => segments.value.filter(s => s.type === 'sprint').length)

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

const description = computed(() => segments.value.length
  ? `The fastest bike and wheel combo for every rankable Zwift segment - ${climbCount.value} climbs and ${sprintCount.value} sprints, ranked by predicted time for your rider profile.`
  : 'The fastest bike and wheel combo for every rankable Zwift climb and sprint, ranked by predicted time for your rider profile.')

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
        Every rankable segment in Zwift - {{ climbCount }} climbs and {{ sprintCount }} sprints -
        with the bike and wheel combo our physics model predicts fastest for each one, tuned to
        your own weight, height and power once you set a rider profile.
      </p>
    </div>

    <USelectMenu
      v-model="typeFilter"
      value-key="value"
      :items="typeOptions"
      :search-input="false"
      class="w-48"
    />

    <p
      v-if="!worldGroups.length"
      class="text-muted"
    >
      No segments match this filter.
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
