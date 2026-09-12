<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'

/**
 * The Ranking from rank 2 down, with the search box that narrows it and the
 * comparison picks. Rank 1 is not repeated here: it is the Recommendation
 * above, carrying the same marker, the same Compare checkbox and a link back
 * to this section, so one ranking lives in one place and no setup appears
 * twice. The full `combos` still arrives - the first is skipped on render, so
 * the ranks are the page's own and nothing has to be sliced upstream.
 *
 * Search is the page's request state (`v-model:search` onto
 * `useRecommendRequest().bikeSearch`), so a term reaches the whole eligible
 * catalog through the same request as everything else - never a filter over
 * the rows already loaded, which could not find a bike on an unloaded page
 * or a Halo bike the default filter hides. `selected` holds `comboKey`s in
 * pick order; the page turns them back into combos for the comparison.
 */
const props = defineProps<{
  /** The whole ranking, rank 1 first; the rows below start at its second entry. */
  combos: ComboScore[]
  route?: RouteWithMeta
  laps?: number
  fastestTimeSec?: number
  loadWheelOptions?: (frameId: number) => Promise<ComboScore[]>
  /** The serialised query these results belong to, so the drawer's route curve can follow it - see `upgradeCurveKey`. */
  requestKey?: string
  hasMore: boolean
  loadingMore: boolean
}>()

defineEmits<{ showMore: [] }>()

const search = defineModel<string>('search', { default: '' })
const selected = defineModel<string[]>('selected', { default: () => [] })

/** Where the rows pick the ranking up, the Recommendation having taken rank 1. */
const FIRST_ROW_RANK = 2
/** Empty on a ranking of one, which is a recommendation with nothing beneath it. */
const rest = computed(() => props.combos.slice(FIRST_ROW_RANK - 1))
const compareFull = computed(() => selected.value.length >= COMPARISON_LIMIT)
function toggle(combo: ComboScore) {
  selected.value = toggleComparison(selected.value, comboKey(combo))
}
const listId = useId()
</script>

<template>
  <section
    id="ride-ranking"
    aria-labelledby="ride-alternatives-heading"
    class="min-w-0 scroll-mt-6"
  >
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">
          The ranking
        </p>
        <h2
          id="ride-alternatives-heading"
          class="text-xl font-semibold text-highlighted"
        >
          Every setup behind the fastest
        </h2>
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
    <div
      v-if="selected.length"
      class="mt-3"
    >
      <UButton
        icon="i-lucide-columns-3"
        size="sm"
        color="primary"
        variant="link"
        class="px-0"
        @click="showComparison()"
      >
        Show comparison &middot; {{ selected.length }} of {{ COMPARISON_LIMIT }}
      </UButton>
    </div>
    <ol
      v-if="rest.length"
      :id="listId"
      :start="FIRST_ROW_RANK"
      class="mt-4 border-b border-default"
      aria-label="Ranked setups"
    >
      <RideAlternativeRow
        v-for="(combo, index) in rest"
        :key="comboKey(combo)"
        :combo="combo"
        :rank="FIRST_ROW_RANK + index"
        :route="route"
        :laps="laps"
        :fastest-time-sec="fastestTimeSec"
        :load-wheel-options="loadWheelOptions"
        :request-key="requestKey"
        :compared="selected.includes(comboKey(combo))"
        :compare-disabled="compareFull && !selected.includes(comboKey(combo))"
        @toggle-compare="toggle(combo)"
      />
    </ol>
    <p
      v-else
      class="mt-6 text-muted"
      role="status"
    >
      <!-- Two different emptinesses: nothing ranked at all, which the
           recommendation above is also reporting, and a ranking of one, where
           the answer is up there and only the field behind it is missing. -->
      <template v-if="!combos.length">
        <template v-if="search">
          Nothing in the catalog matches "{{ search }}" under the current filters.
        </template>
        <template v-else>
          Nothing to rank under the current filters.
        </template>
      </template>
      <template v-else>
        <template v-if="search">
          Nothing else matches "{{ search }}" under the current filters.
        </template>
        <template v-else>
          Nothing else matches under the current filters.
        </template>
      </template>
    </p>
    <div
      v-if="hasMore"
      class="mt-6 text-center"
    >
      <UButton
        color="neutral"
        variant="subtle"
        :loading="loadingMore"
        @click="$emit('showMore')"
      >
        Show more matches
      </UButton>
    </div>
  </section>
</template>
