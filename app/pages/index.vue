<script setup lang="ts">
import type { SegmentSummary } from '../../shared/types/catalog'
import { ROUTE_SURFACE_WORDS, type RouteCardData } from '#shared/utils/routeCards'
import { filterRouteCards, ROUTE_LIST_PAGE_SIZE } from '../utils/routeCardFilters'
import { matchesSearch, NEAR_MATCH_LIMIT, nearMatches } from '../utils/homeSearch'

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
  alt: 'ZwiftBikes – find the fastest bike and wheelset for any Zwift route'
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

// World, terrain, surface, distance and elevation - shared with the
// Standings pages through `useRouteFilters`, which `RouteFilterBar` edits.
const routeFilters = useRouteFilters()
const visibleCount = ref(ROUTE_LIST_PAGE_SIZE)

// Every cycling route's card, once (#262): the prerendered payload carries
// them all - 48 heights and a few surface spans each - and every filter below
// works over that list in the browser, so a filter change makes no request
// and draws no geometry. Should the catalog outgrow the payload budget
// (`server/utils/routeCardCatalog.test.ts`), the fallback is filtering and paging on
// the server.
const { data } = await useFetch<{ cards: RouteCardData[], worlds: { slug: string, name: string }[] }>('/api/route-cards', { key: 'route-cards' })
const allCards = computed(() => data.value?.cards ?? [])

// "Browse by world" (#58): every world's World page, with its route count,
// in a row under the grid since #331 slimmed the hero to its search.
// Server-rendered links, unlike the World select further up, so a crawler
// reaches every route page in two clicks from here - the grid's first page
// alone left 113 of them with no link path at all. Counted from the cards
// already fetched, so the payload does not grow.
const worldLinks = computed(() => worldRouteCounts(allCards.value, data.value?.worlds ?? []))

// Routes only: segments have their own browsable home at /segments (linked
// from the nav and below the hero), so the old merged routes-and-segments
// mode - and the "Show" kind filter that gated it - is gone. One page per
// content type keeps both lists' filters honest: the distance/elevation/
// surface controls here never applied to segments anyway.
const filters = computed(() => ({
  search: searchDebounced.value,
  ...routeFilters.active
}))
const items = computed<RouteCardData[]>(() => filterRouteCards(allCards.value, filters.value))
const visibleItems = computed(() => items.value.slice(0, visibleCount.value))
// Routes are the only thing counted here, so the line reads "24 routes
// found" - the segments page counts climbs and sprints separately.
const resultCounts = computed(() => [{ value: items.value.length, noun: 'route' }])
const countLine = computed(() => discoveryCountLine(resultCounts.value))

// The climbs and sprints the search also offers (#331), fetched the first
// time the search is used - focused, or restored from `?q=` - rather than
// with the page, so the homepage's own load does not grow by them. A failed
// fetch leaves them undefined and lets the next use try again: the search
// still answers with routes meanwhile.
const segments = shallowRef<SegmentSummary[]>()
let segmentsRequest: Promise<void> | undefined
function loadSegments() {
  segmentsRequest ??= $fetch<{ segments: SegmentSummary[] }>('/api/segments')
    .then((response) => {
      segments.value = response.segments
    })
    .catch(() => {
      segmentsRequest = undefined
    })
}

// A term that names no route at all, whatever the other filters, gets the
// search's own empty state above the grid - the term, the climbs and
// sprints it does name, the routes it was closest to, and Reset - as it
// does in the dropdown. A term that matches routes the other filters then
// leave out keeps the filters' message.
const unmatchedTerm = computed(() => {
  const term = searchDebounced.value
  return term.trim() && !allCards.value.some(card => matchesSearch(card, term)) ? term : undefined
})
const termSegments = computed(() => unmatchedTerm.value ? (segments.value ?? []).filter(segment => matchesSearch(segment, unmatchedTerm.value!)) : [])
const nearRoutes = computed(() => unmatchedTerm.value && !termSegments.value.length ? nearMatches(allCards.value, unmatchedTerm.value, NEAR_MATCH_LIMIT) : [])

// Whose rider the times on the site are for, under the search - the default
// is never silent. Read after mount like everything stored.
const { weightKg, powerW, hasStoredProfile, load: loadRiderProfile } = useRiderProfile()
const { openProfile } = useOverlays()
onMounted(loadRiderProfile)

const routeFinderHeading = useTemplateRef<HTMLElement>('routeFinderHeading')
// The URL write the filters' watcher last started, for `openRide` to wait on.
let urlWrite: Promise<unknown> | undefined

/** Settles the typed term at once, as the filters and the URL read it, instead of after the debounce. */
async function commitSearch() {
  clearTimeout(searchDebounceTimer)
  searchDebounced.value = search.value
  await nextTick()
  await urlWrite
}

// Choosing from the search's list: the term goes into the URL before the
// page is left, so back returns to the same search and the same grid even
// when the rider chose before the debounce settled.
async function openRide(to: string) {
  await commitSearch()
  await navigateTo(to)
}

// Enter with nothing chosen: the grid is the rest of the answer, a screen
// or more below the hero, so take the rider to it.
async function showResults() {
  await commitSearch()
  routeFinderHeading.value?.scrollIntoView({ block: 'start' })
}

function resetFilters() {
  // The debounce is for typing; a reset shows the whole catalog at once.
  clearTimeout(searchDebounceTimer)
  search.value = ''
  searchDebounced.value = ''
  routeFilters.reset()
}

watch(filters, () => {
  visibleCount.value = ROUTE_LIST_PAGE_SIZE
})

// The filters live in the URL too - `?q=alpe&world=watopia&surface=gravel
// &dist=10-40&elev=0-500` - read once after mount and written from the
// committed values, see `useUrlState` and `useRouteFilters`.
const { param, enumParam, searchParam, slugParam, replaceQuery } = useUrlState(useRoute(), useRouter())
onMounted(() => {
  const q = searchParam('q')
  if (q) {
    // Straight to the grid too: the debounce is for typing, and a restored
    // view that showed the whole catalog for 300 ms first would be a flicker.
    search.value = q
    searchDebounced.value = q
    loadSegments()
  }
  routeFilters.restore({ param, enumParam, slugParam })
})
watch(filters, (value) => {
  urlWrite = replaceQuery({
    q: value.search || undefined,
    ...routeFilters.query
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
        <HomeSearch
          v-model="search"
          :cards="allCards"
          :segments="segments"
          class="mt-6"
          @focus="loadSegments"
          @open="openRide"
          @submit="showResults"
          @reset="resetFilters"
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
        ref="routeFinderHeading"
        class="scroll-mt-[calc(var(--ui-header-height)+1rem)] text-2xl font-semibold font-heading text-highlighted"
      >
        Every route, by its shape
      </h2>
      <p class="mt-1 text-sm text-muted">
        Each card draws the route's elevation profile, so you can pick by terrain before you read a number.
      </p>
      <!-- The strip's two colours in the Surface filter's own words (#331):
           the gravel colour is every loose surface and the cobbles colour
           brick and wood too, as "Includes gravel" and "Includes cobbles"
           already count them. -->
      <p class="mt-1.5 text-sm text-muted">
        Under each profile, the surface strip marks
        <span
          class="mx-1 inline-block h-1 w-4 rounded-[2px] bg-dirt align-middle"
          aria-hidden="true"
        />{{ ROUTE_SURFACE_WORDS.gravel }} and
        <span
          class="mx-1 inline-block h-1 w-4 rounded-[2px] bg-rough align-middle"
          aria-hidden="true"
        />{{ ROUTE_SURFACE_WORDS.cobble }}.
      </p>

      <RouteFilterBar
        class="mt-4"
        :filters="routeFilters"
        :worlds="data?.worlds ?? []"
        :count-line="countLine"
        @reset="resetFilters"
      />

      <DiscoveryStatus
        class="mt-5"
        subject="routes"
        :counts="resultCounts"
        count-elsewhere
      >
        <template
          v-if="unmatchedTerm"
          #empty
        >
          <SearchEmptyState
            :term="unmatchedTerm"
            :near="nearRoutes"
            :segments="termSegments"
            :segments-checked="!!segments"
            class="py-8"
            @reset="resetFilters"
          />
        </template>
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
              @click="visibleCount += ROUTE_LIST_PAGE_SIZE"
            >
              Show more ({{ items.length - visibleCount }} remaining)
            </UButton>
          </div>
        </div>
      </DiscoveryStatus>
    </section>

    <nav
      v-if="worldLinks.length"
      aria-labelledby="browse-by-world-heading"
      class="mt-12"
    >
      <h2
        id="browse-by-world-heading"
        class="text-sm font-medium text-muted"
      >
        Browse by world
      </h2>
      <!-- Each link is a full 44px target (#331); the row stays plain
           server-rendered links for the crawler, see `worldLinks`. -->
      <ul class="mt-1 -ml-2.5 flex flex-wrap text-sm">
        <li
          v-for="world in worldLinks"
          :key="world.slug"
        >
          <NuxtLink
            :to="`/worlds/${world.slug}`"
            class="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-toned hover:text-highlighted hover:underline"
          >
            {{ world.name }} <span class="text-muted">{{ world.routes }}</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <div class="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-default bg-elevated px-6 py-5">
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
