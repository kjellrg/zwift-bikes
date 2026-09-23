<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'
import { RECOMMEND_MAX_LIMIT } from '#shared/utils/recommendLimits'
import type { AppliedRanking } from '../utils/recommendRequest'

/**
 * The Ranking as a table, from rank 1 down (see **Ranking** in
 * `CONTEXT.md`): the filters that produced it as chips above it, the
 * Directed search beside its heading, and a row per setup whose disclosure
 * holds the technical detail. The Recommendation above is rank 1 shown as
 * the answer; rank 1's row stays here so the fastest and the rest are read
 * together, and the row controls live once, on the rows.
 *
 * Search is the page's request state (`v-model:search` onto
 * `useRecommendRequest().bikeSearch`), so a term reaches the whole eligible
 * catalog through the same request as everything else - never a filter over
 * the rows already loaded. `selected` holds `comboKey`s in pick order; the
 * page turns them back into combos for the comparison.
 *
 * The gap bars are scaled to the largest gap on the first page of the
 * Applied Ranking and are not rescaled as Show more appends rows, so no bar
 * moves under the rider; a later row past the scale draws a full bar. A
 * replaced Ranking (a new `requestKey`) takes a new scale.
 */
const props = defineProps<{
  ranking: AppliedRanking
  hasMore: boolean
  canShowMore: boolean
  appliedSearch: string
  loadingMore: boolean
  /** The last Show more failed; the ranking itself is untouched and the button is live again. */
  expansionFailed: boolean
  /** Passed to the chips - see `RideEquipmentFilters`. */
  hideTtCategory?: boolean
}>()

defineEmits<{ showMore: [] }>()

const search = defineModel<string>('search', { default: '' })
const selected = defineModel<string[]>('selected', { default: () => [] })

const { allColumns, setAllColumns, verifiedOnly, myBikesOnly, setBikeCategory, setVerifiedOnly, setMyBikesOnly } = usePreferences()

const compareFull = computed(() => selected.value.length >= COMPARISON_LIMIT)
function toggleCompare(combo: ComboScore) {
  selected.value = toggleComparison(selected.value, comboKey(combo))
}

function largestGap(ranking: AppliedRanking): number {
  const fastest = ranking.fastestTimeSec
  if (fastest === undefined) return 0
  return ranking.combos.reduce((max, combo) => Math.max(max, (combo.finishTimeSec ?? fastest) - fastest), 0)
}
const barScale = ref(largestGap(props.ranking))
watch(() => props.ranking.requestKey, () => {
  barScale.value = largestGap(props.ranking)
})
function barFor(combo: ComboScore): number {
  if (combo.finishTimeSec === undefined || props.ranking.fastestTimeSec === undefined || barScale.value <= 0) return 0
  return Math.min(1, (combo.finishTimeSec - props.ranking.fastestTimeSec) / barScale.value)
}

// One disclosure open at a time. Keyed by setup, so a row that keeps its
// place through a refresh stays open and asks for its wheels again under
// the new Ranking (see `ComboWheelAlternatives`).
const openKey = ref<string>()
function toggleRow(combo: ComboScore) {
  const key = comboKey(combo)
  openKey.value = openKey.value === key ? undefined : key
}

function clearSearch() {
  search.value = ''
}

/**
 * The one widening action an empty Ranking offers: the narrowest thing the
 * rider did last, in the order they are most likely to have done it. The
 * category is the one the Ranking was made under, not the stored one: on a
 * ride that bars TT frames a stored `tt` already ranks as all categories,
 * so offering to widen it would change nothing and overwrite the rider's
 * `tt` for every other page.
 */
const widening = computed<{ label: string, run: () => void } | undefined>(() => {
  if (props.appliedSearch) return { label: 'Clear the search', run: clearSearch }
  if (props.ranking.rider.category !== 'all') return { label: 'Show all categories', run: () => setBikeCategory('all') }
  if (verifiedOnly.value) return { label: 'Include estimated data', run: () => setVerifiedOnly(false) }
  if (myBikesOnly.value) return { label: 'Rank beyond my garage', run: () => setMyBikesOnly(false) }
  return undefined
})

const headingId = useId()
</script>

<template>
  <section
    id="ride-ranking"
    :aria-labelledby="headingId"
    class="min-w-0 scroll-mt-24"
  >
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <h2
          :id="headingId"
          class="text-2xl font-semibold font-heading text-highlighted"
        >
          Every setup, ranked
        </h2>
        <p class="mt-1 text-sm text-muted">
          Gap to the fastest. Open a row for its wheels, upgrades and the numbers behind it.
        </p>
      </div>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search all frames and wheels"
        aria-label="Search all frames and wheels"
        class="w-full sm:w-72"
        :ui="{ trailing: 'pe-1' }"
      >
        <template
          v-if="search"
          #trailing
        >
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            icon="i-lucide-circle-x"
            aria-label="Clear search"
            @click="search = ''"
          />
        </template>
      </UInput>
    </div>

    <RideEquipmentFilters
      :applied-restrictions="ranking.restrictions"
      :hide-tt-category="hideTtCategory"
    />

    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <button
        v-if="selected.length"
        type="button"
        class="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        @click="showComparison()"
      >
        <UIcon
          name="i-lucide-columns-3"
          class="size-4"
        />Show comparison, {{ selected.length }} of {{ COMPARISON_LIMIT }}
      </button>
      <span
        v-else
        class="text-sm text-muted"
      >Pick up to {{ COMPARISON_LIMIT }} setups in their rows to compare them.</span>
      <USwitch
        :model-value="allColumns"
        label="All columns"
        size="sm"
        @update:model-value="(value: boolean) => setAllColumns(value)"
      />
    </div>

    <div
      v-if="ranking.combos.length"
      class="mt-3"
      :class="allColumns ? 'overflow-x-auto' : 'md:overflow-x-auto'"
    >
      <table
        class="w-full border-collapse text-md"
        :class="allColumns ? 'min-w-[60rem]' : 'max-md:block'"
        aria-label="Ranked setups"
      >
        <thead :class="!allColumns && 'max-md:hidden'">
          <tr class="border-b border-accented text-left text-xs text-muted">
            <th
              scope="col"
              class="px-2.5 pb-2 text-right font-medium"
            >
              #
            </th>
            <th
              scope="col"
              class="px-2.5 pb-2 font-medium"
            >
              Frame and wheels
            </th>
            <th
              scope="col"
              class="px-2.5 pb-2 text-right font-medium"
            >
              Time
            </th>
            <th
              scope="col"
              class="px-2.5 pb-2 text-right font-medium"
            >
              Gap
            </th>
            <th
              scope="col"
              class="px-2.5 pb-2 font-medium"
            >
              <span class="sr-only">Gap bar</span>
            </th>
            <th
              scope="col"
              class="px-2.5 pb-2 font-medium"
            >
              Aero / climb
            </th>
            <th
              scope="col"
              class="px-2.5 pb-2 font-medium"
            >
              Style
            </th>
            <template v-if="allColumns">
              <th
                scope="col"
                class="px-2.5 pb-2 text-right font-medium"
              >
                Drag area Δ
              </th>
              <th
                scope="col"
                class="px-2.5 pb-2 text-right font-medium"
              >
                Mass Δ
              </th>
              <th
                scope="col"
                class="px-2.5 pb-2 font-medium"
              >
                Wheels
              </th>
              <th
                scope="col"
                class="px-2.5 pb-2 font-medium"
              >
                Data
              </th>
            </template>
            <th
              scope="col"
              class="px-1.5 pb-2 font-medium"
            >
              <span class="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <RideRankingRow
          v-for="(combo, index) in ranking.combos"
          :key="comboKey(combo)"
          :combo="combo"
          :rank="index + 1"
          :ranking="ranking"
          :open="openKey === comboKey(combo)"
          :compared="selected.includes(comboKey(combo))"
          :compare-disabled="compareFull && !selected.includes(comboKey(combo))"
          :bar="barFor(combo)"
          :all-columns="allColumns"
          @toggle="toggleRow(combo)"
          @toggle-compare="toggleCompare(combo)"
        />
      </table>
    </div>
    <p
      v-else
      class="mt-6 text-muted"
      role="status"
    >
      <template v-if="appliedSearch">
        Nothing in the catalog matches "{{ appliedSearch }}" under the current filters.
      </template>
      <template v-else>
        Nothing to rank under the current filters.
      </template>
      <button
        v-if="widening"
        type="button"
        class="ml-1 text-primary underline"
        @click="widening.run"
      >
        {{ widening.label }}
      </button>
    </p>

    <div
      v-if="hasMore"
      class="mt-5 text-center"
    >
      <UButton
        color="neutral"
        variant="outline"
        :loading="loadingMore"
        :disabled="!canShowMore"
        @click="$emit('showMore')"
      >
        Show the next {{ RECOMMEND_MAX_LIMIT }}
      </UButton>
      <!-- Beside the button rather than up with the refresh notice: this
           failure took nothing away, and pressing again is the whole of the
           recovery. -->
      <p
        v-if="expansionFailed"
        class="mt-2 text-sm text-error"
        role="alert"
      >
        Couldn't load more setups - the ranking above is unchanged.
      </p>
    </div>
  </section>
</template>
