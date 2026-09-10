<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'

/**
 * The ranked list under the recommendation, with the search box that
 * narrows it and the comparison picks. The list starts at rank 1 on
 * purpose: the recommendation above is the answer, this is the field it
 * won against, and a rider comparing the winner with a runner-up needs its
 * checkbox here.
 *
 * Search is the page's request state (`v-model:search` onto
 * `useRecommendRequest().bikeSearch`), so a term reaches the whole eligible
 * catalog through the same request as everything else - never a filter over
 * the rows already loaded, which could not find a bike on an unloaded page
 * or a Halo bike the default filter hides. `selected` holds `comboKey`s in
 * pick order; the page turns them back into combos for the comparison.
 */
defineProps<{
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

const compareFull = computed(() => selected.value.length >= COMPARISON_LIMIT)
function toggle(combo: ComboScore) {
  selected.value = toggleComparison(selected.value, comboKey(combo))
}
const listId = useId()
</script>

<template>
  <section
    aria-labelledby="ride-alternatives-heading"
    class="min-w-0"
  >
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">
          The chasing pack
        </p>
        <h2
          id="ride-alternatives-heading"
          class="text-xl font-semibold text-highlighted"
        >
          Compare the alternatives
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
    <p
      v-if="selected.length"
      class="mt-3 text-sm text-muted"
    >
      <a
        href="#ride-comparison"
        class="text-primary underline"
      >Comparing {{ selected.length }} of {{ COMPARISON_LIMIT }}</a>
    </p>
    <ol
      v-if="combos.length"
      :id="listId"
      class="mt-4 border-b border-default"
      aria-label="Ranked setups"
    >
      <RideAlternativeRow
        v-for="(combo, index) in combos"
        :key="comboKey(combo)"
        :combo="combo"
        :rank="index + 1"
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
      <template v-if="search">
        Nothing in the catalog matches "{{ search }}" under the current filters.
      </template>
      <template v-else>
        Nothing to rank under the current filters.
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
