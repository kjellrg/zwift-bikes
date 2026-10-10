<script setup lang="ts">
import { worldStatement } from '#shared/utils/worldStatement'

/**
 * A World page (#58; see **World page** in CONTEXT.md): every route in one
 * world, then its climbs and sprints, all of it in the server's HTML. It
 * exists because the homepage links only its first page of cards and its
 * world filter is a select, not a link - before this page, 113 of the 293
 * route pages had no link path from the homepage at all.
 *
 * So it has nothing to narrow and nothing held back: no search, no filter,
 * no "Show more", and no `DiscoveryStatus`, since there is no request after
 * the first for it to report on. The homepage is where a rider narrows the
 * catalog; this is where a world is read in full. Rows rather than cards:
 * 110 cards would be a second homepage.
 *
 * Fetched rather than imported, like the segments index: the listing is cut
 * from the catalog on the server (`worldListing`), and importing the catalog
 * here would drag it into the client bundle.
 */
const route = useRoute()
const slug = computed(() => route.params.slug as string)

const { data, error } = await useFetch(() => `/api/worlds/${slug.value}`)
if (error.value || !data.value) throw createError({ statusCode: 404, statusMessage: 'World not found', fatal: true })

const worldName = computed(() => data.value?.world.name ?? '')
const routes = computed(() => data.value?.routes ?? [])
// Already in the segments index's order - climbs by climbing gained, then
// sprints by name - so splitting them keeps it.
const climbs = computed(() => (data.value?.segments ?? []).filter(segment => segment.type === 'climb'))
const sprints = computed(() => (data.value?.segments ?? []).filter(segment => segment.type === 'sprint'))
// What the page says about itself, stated once with its twin
// (`worldStatement`), so the H1 and counts line here and in the markdown
// cannot drift apart.
const statement = computed(() => worldStatement({ name: worldName.value, routes: routes.value.length, climbs: climbs.value.length, sprints: sprints.value.length }))

useSeoMeta({
  title: () => statement.value.title,
  description: () => statement.value.description,
  ogTitle: () => statement.value.heading,
  ogDescription: () => statement.value.description
})
// The brand card, as the other discovery pages carry: a per-world card was
// left out when the page was specified (#58).
defineOgImage('SiteCard', {}, { alt: `ZwiftBikes – every Zwift route in ${worldName.value}, ranked by bike` })

const siteConfig = useSiteConfig()
useHead({
  script: [{
    type: 'application/ld+json',
    innerHTML: () => JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
        { '@type': 'ListItem', 'position': 2, 'name': worldName.value, 'item': `${siteConfig.url}/worlds/${slug.value}` }
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
          <li>{{ worldName }}</li>
        </ol>
      </nav>
      <h1 class="mt-3 text-balance text-[clamp(2.25rem,6vw,3.75rem)] leading-none font-bold font-display tracking-[-0.01em] text-highlighted">
        {{ statement.heading }}
      </h1>
      <p class="mt-4 text-lg text-toned">
        {{ statement.countLine }}
      </p>
    </div>

    <section
      aria-labelledby="world-routes-heading"
      class="mt-10"
    >
      <h2
        id="world-routes-heading"
        class="text-2xl font-semibold font-heading text-highlighted"
      >
        Routes
      </h2>
      <!-- One row a route, by name: its Silhouette small, then the numbers a
           rider picks a route by, inline, as the homepage card gives them. -->
      <ul class="mt-3 divide-y divide-default border-y border-default">
        <li
          v-for="entry in routes"
          :key="entry.slug"
        >
          <NuxtLink
            :to="`/routes/${entry.slug}`"
            class="group flex items-center gap-4 py-2.5"
          >
            <RouteSilhouette
              :shape="entry.shape"
              strip
              class="h-9 w-20 shrink-0 sm:w-28"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-x-6 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
              <span class="min-w-0 font-semibold text-highlighted group-hover:underline">{{ entry.name }}</span>
              <span class="flex shrink-0 flex-wrap items-baseline gap-x-3 text-sm text-toned">
                <span><span class="font-semibold text-highlighted">{{ entry.distance.toFixed(1) }}</span> km</span>
                <span><span class="font-semibold text-highlighted">{{ Math.round(entry.elevation) }}</span> m</span>
                <span>{{ TERRAIN_LABELS[entry.terrain] }}</span>
                <span>{{ routeSurfaceWords(entry.surface) }}</span>
                <span
                  v-if="entry.eventOnly"
                  class="text-xs text-muted"
                >Event only</span>
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <!-- The world's climbs and sprints in the form the segments index gives
         a world group, so a climb reads the same on both pages. -->
    <section
      v-if="climbs.length"
      aria-labelledby="world-climbs-heading"
      class="mt-10"
    >
      <h2
        id="world-climbs-heading"
        class="text-2xl font-semibold font-heading text-highlighted"
      >
        Climbs
      </h2>
      <ul class="mt-3 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <li
          v-for="segment in climbs"
          :key="segment.slug"
        >
          <SegmentCard :segment="segment" />
        </li>
      </ul>
    </section>

    <section
      v-if="sprints.length"
      aria-labelledby="world-sprints-heading"
      class="mt-10"
    >
      <h2
        id="world-sprints-heading"
        class="text-2xl font-semibold font-heading text-highlighted"
      >
        Sprints
      </h2>
      <ul class="mt-3 columns-2 gap-x-8 lg:columns-3 xl:columns-4">
        <li
          v-for="segment in sprints"
          :key="segment.slug"
          class="break-inside-avoid"
        >
          <SegmentCard :segment="segment" />
        </li>
      </ul>
    </section>
  </UContainer>
</template>
