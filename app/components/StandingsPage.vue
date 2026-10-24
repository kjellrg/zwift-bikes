<script setup lang="ts">
import type { StandingsCategory, StandingsData, StandingsKind } from '#shared/types/standings'
import { STANDINGS_CATEGORIES } from '#shared/types/standings'
import { discoveryCountLine } from '../utils/discoveryCounts'
import { otherPaintsLine } from '../utils/rankingResults'
import { filterRouteCards } from '../utils/routeCardFilters'
import { bikeRecord, formatMeanGap, profileDiffersFromRider, rankStandings, secondsPerHour, STANDINGS_PAGE_SIZE, usualTimingFrames, wheelTimingNote, winsRecord, type StandingsRow, type StandingsScope } from '../utils/standings'

/**
 * A Standings page (see `CONTEXT.md`): every bike, or every wheelset, ranked
 * by its mean gap to the fastest over the routes the rider filters to. The
 * payload carries every route's gaps, so the filters - the homepage's own,
 * through `useRouteFilters` - and the Road / TT switch work in the browser
 * and make no request.
 */
const props = defineProps<{ kind: StandingsKind }>()

const { data, status, refresh } = await useFetch<StandingsData>(`/api/standings/${props.kind}`, { key: `standings-${props.kind}` })

const category = ref<StandingsCategory>('standard')
const CATEGORY_CHIPS: Record<StandingsCategory, string> = { standard: 'Road', tt: 'Time trial' }

const routeFilters = useRouteFilters()
const routes = computed(() => filterRouteCards(data.value?.routes ?? [], { search: '', ...routeFilters.active }))
const scope = computed<StandingsScope>(() => ({ routes: routes.value, entries: data.value?.entries[category.value] ?? [], category: category.value }))
const standings = computed(() => rankStandings(scope.value.routes, scope.value.entries, scope.value.category))
const counts = computed(() => [{ value: standings.value.routeCount, noun: 'route' }])
const countLine = computed(() => discoveryCountLine(counts.value))

const visibleCount = ref(STANDINGS_PAGE_SIZE)
const visibleRows = computed(() => standings.value.rows.slice(0, visibleCount.value))
watch([() => routeFilters.active, category], () => {
  visibleCount.value = STANDINGS_PAGE_SIZE
})

const { openStandingsWins, openStandingsBike } = useOverlays()
const showWins = (row: StandingsRow) => openStandingsWins(winsRecord(row, category.value))
const showBike = (row: StandingsRow) => openStandingsBike(bikeRecord(row, standings.value.rows, scope.value))

// What differs between the two pages, in one place.
const COPY = {
  bikes: {
    title: 'The fastest bikes across your routes',
    intro: 'Every bot-tested frame, on its own fastest wheels, ridden over every route you pick - and ranked by how far behind each route\'s fastest bike it finishes, on average.',
    heading: 'Bike standings',
    categoryLabel: 'Bikes',
    column: 'Bike'
  },
  wheels: {
    title: 'The fastest wheels across your routes',
    intro: 'Every bot-tested wheelset, on each route\'s fastest bike, ridden over every route you pick - and ranked by how far behind each route\'s fastest wheels it finishes, on average.',
    heading: 'Wheel standings',
    categoryLabel: 'Ridden on',
    column: 'Wheels'
  }
} as const
const copy = computed(() => COPY[props.kind])

const subjects = computed(() => props.kind === 'bikes'
  ? { plural: 'bikes', category: category.value === 'tt' ? 'TT bikes' : 'road bikes' }
  : { plural: 'wheels', category: category.value === 'tt' ? 'wheels on TT bikes' : 'wheels on road bikes' })

// The rider the times are for. Precomputed, so always the default one -
// said every time, and said again to a rider whose own profile the route
// pages use instead. Read after mount like everything stored.
const { weightKg, heightCm, powerW, hasStoredProfile, load: loadRiderProfile } = useRiderProfile()
const { openProfile } = useOverlays()
onMounted(loadRiderProfile)
const rider = computed(() => data.value?.rider)
const profileDiffers = computed(() => hasStoredProfile.value && rider.value
  && profileDiffersFromRider({ weightKg: weightKg.value, heightCm: heightCm.value, powerW: powerW.value }, rider.value))

const wheelNote = computed(() => wheelTimingNote(category.value, usualTimingFrames(routes.value, category.value)))

// The filters live in the URL, as the homepage's do - `?category=tt
// &world=watopia&terrain=hilly` - read once after mount and written from the
// committed values. They belong to the page: never a Shared view, never the
// rider's stored preferences.
const { param, enumParam, slugParam, replaceQuery } = useUrlState(useRoute(), useRouter())
onMounted(() => {
  const tt = enumParam('category', ['tt'] as const)
  if (tt) category.value = tt
  routeFilters.restore({ param, enumParam, slugParam })
})
watch([() => routeFilters.query, category], ([query, chosen]) => {
  replaceQuery({ category: chosen === 'standard' ? undefined : chosen, ...query })
})
</script>

<template>
  <UContainer class="pb-8">
    <div class="pt-10 pb-5 lg:pt-16 lg:pb-7">
      <h1 class="text-balance text-[clamp(2.25rem,5.5vw,3.75rem)] leading-[0.98] font-bold font-display tracking-[-0.01em] text-highlighted">
        {{ copy.title }}
      </h1>
      <p class="mt-4 max-w-[60ch] text-lg text-toned">
        {{ copy.intro }}
      </p>
      <p
        v-if="rider"
        class="mt-3.5 text-sm text-muted"
      >
        Times are for the default rider, {{ rider.weightKg }} kg at {{ rider.powerW }} W, riding solo with every frame fully upgraded - the same rankings each route's page shows for that rider.
        <template v-if="profileDiffers">
          Your profile, {{ weightKg }} kg at {{ powerW }} W, applies on each route's own page; these standings are worked out ahead of time, across every route at once, so they stay with the default rider.
          <a
            href="/profile"
            aria-haspopup="dialog"
            class="text-primary underline decoration-primary/40 hover:decoration-primary"
            @click="openProfile"
          >Edit your profile</a>
        </template>
      </p>
    </div>

    <section
      aria-labelledby="standings-heading"
      class="mt-6"
    >
      <h2
        id="standings-heading"
        class="text-2xl font-semibold font-heading text-highlighted"
      >
        {{ copy.heading }}
      </h2>
      <p class="mt-1 text-sm text-muted">
        Narrow the routes and the standings follow: only the routes your filters leave are averaged.
      </p>

      <div class="mt-4">
        <p
          :id="`standings-category-${kind}`"
          class="mb-1 block text-xs text-muted"
        >
          {{ copy.categoryLabel }}
        </p>
        <div
          class="flex flex-wrap gap-1.5"
          role="group"
          :aria-labelledby="`standings-category-${kind}`"
        >
          <button
            v-for="value in STANDINGS_CATEGORIES"
            :key="value"
            type="button"
            class="inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors"
            :class="category === value ? 'border-ink bg-accented text-highlighted' : 'border-accented bg-elevated text-toned hover:text-highlighted'"
            :aria-pressed="category === value"
            @click="category = value"
          >
            {{ CATEGORY_CHIPS[value] }}
          </button>
        </div>
      </div>

      <RouteFilterBar
        class="mt-4"
        :filters="routeFilters"
        :worlds="data?.worlds ?? []"
        :count-line="countLine"
        @reset="routeFilters.reset()"
      />

      <DiscoveryStatus
        class="mt-5"
        subject="routes"
        :counts="counts"
        :status="status"
        count-elsewhere
        @retry="refresh"
      >
        <div class="space-y-6">
          <table class="w-full border-collapse text-left">
            <caption class="sr-only">
              {{ subjects.category }}, ranked by mean gap to the fastest over {{ routesLabel(standings.routeCount) }}
            </caption>
            <thead>
              <tr class="border-b border-default text-xs text-muted">
                <th
                  scope="col"
                  class="w-11 px-2.5 py-2 text-right font-normal"
                >
                  Rank
                </th>
                <th
                  scope="col"
                  class="px-2.5 py-2 font-normal"
                >
                  {{ copy.column }}
                </th>
                <th
                  scope="col"
                  class="px-2.5 py-2 text-right font-normal"
                >
                  Mean gap
                </th>
                <th
                  scope="col"
                  class="px-2.5 py-2 text-right font-normal max-sm:hidden"
                >
                  Fastest on
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in visibleRows"
                :key="row.entry.id"
                class="border-b border-default align-top"
              >
                <td
                  class="w-11 px-2.5 pt-4 text-right text-sm"
                  :class="row.rank === 1 ? 'font-semibold text-primary' : 'text-muted'"
                >
                  {{ row.rank }}
                </td>
                <td class="min-w-0 px-2.5 py-3">
                  <p class="font-semibold text-highlighted break-words">
                    <button
                      v-if="kind === 'bikes'"
                      type="button"
                      aria-haspopup="dialog"
                      class="text-left font-semibold underline decoration-rule-strong hover:decoration-current"
                      :aria-label="`Details for ${row.entry.name}`"
                      @click="showBike(row)"
                    >
                      {{ row.entry.name }}
                    </button>
                    <template v-else>
                      {{ row.entry.name }}
                    </template>
                  </p>
                  <p
                    v-if="row.entry.otherPaints"
                    class="text-xs text-muted break-words"
                  >
                    {{ otherPaintsLine(row.entry.otherPaints) }}
                  </p>
                  <p
                    v-if="row.entry.sameTimes"
                    class="text-xs text-muted break-words"
                  >
                    Times the same as {{ row.entry.sameTimes.join(', ') }}
                  </p>
                  <p class="text-sm text-muted sm:hidden">
                    Fastest on
                    <StandingsWinsButton
                      :row="row"
                      @open="showWins(row)"
                    />
                  </p>
                </td>
                <td class="whitespace-nowrap px-2.5 py-3 text-right">
                  <p class="text-lg font-semibold font-heading text-highlighted">
                    {{ formatMeanGap(row.meanGapPct) }}
                  </p>
                  <p class="text-xs text-muted">
                    ≈ {{ secondsPerHour(row.meanGapPct) }} s per hour
                  </p>
                </td>
                <td class="whitespace-nowrap px-2.5 pt-4 text-right text-toned max-sm:hidden">
                  <StandingsWinsButton
                    :row="row"
                    @open="showWins(row)"
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <div
            v-if="visibleCount < standings.rows.length"
            class="text-center"
          >
            <UButton
              color="neutral"
              variant="outline"
              @click="visibleCount = standings.rows.length"
            >
              Show all {{ standings.rows.length }} {{ subjects.plural }}
            </UButton>
          </div>

          <p
            v-if="standings.untimed.length"
            class="text-sm text-muted"
          >
            Not ranked, because some of these routes have no time for them yet: {{ standings.untimed.map(entry => entry.name).join(', ') }}.
          </p>
        </div>
      </DiscoveryStatus>

      <div class="mt-8 max-w-[70ch] space-y-2 text-sm text-muted">
        <h3 class="font-medium text-toned">
          How the standings are worked out
        </h3>
        <p v-if="kind === 'bikes'">
          On each route, every frame is timed on its own fastest wheels and compared with the route's fastest {{ category === 'tt' ? 'TT' : 'road' }} bike - the ranking that route's page shows.
        </p>
        <p v-else>
          {{ wheelNote }}
        </p>
        <p>
          A gap counts as its share of the route's fastest time, so each route weighs the same however long it is, and the standings rank the mean of those shares. The seconds per hour are that same share as time: what it costs over an hour of riding.
        </p>
        <p v-if="data?.untimedRoutes">
          {{ data.untimedRoutes }} {{ data.untimedRoutes === 1 ? 'route is' : 'routes are' }} newer than these standings and not counted yet.
        </p>
      </div>
    </section>
  </UContainer>
</template>
