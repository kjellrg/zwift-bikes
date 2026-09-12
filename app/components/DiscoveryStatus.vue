<script setup lang="ts">
/**
 * What a discovery page (see `CONTEXT.md`) says about its own list: how many
 * Rides matched, that they are still being fetched, that none matched, or
 * that the fetch failed. The filter rows above it stay on the pages - the
 * homepage has ranges and a surface, the segments page a kind, and they share
 * not one control - but the states a list can be in are the same on each of
 * them, and one component is how they stay one vocabulary instead of three.
 *
 * The matched Rides come through the default slot and the shape they load
 * into through `#skeleton`: a flat card grid on the homepage, world groups on
 * the segments page, round groups on a season page. Which of the two is on
 * screen is decided here, so no page has to spell out that a skeleton and an
 * empty message are mutually exclusive.
 *
 * The empty branch belongs to the pages that have filters, and says so - "No
 * routes match your filters". A season page has none, so it does not render
 * this component at all once its calendar is loaded and has nothing upcoming:
 * a season being over is an answer in its own words, not a search that
 * matched nothing. See `showsStatus` in `pages/events/[season]/index.vue`.
 */

/** One counted noun of the count line, e.g. `{ value: 12, noun: 'climb' }` -> "12 climbs". Every noun these pages count takes a plain `-s`. */
export interface DiscoveryCount {
  value: number
  noun: string
}

const props = defineProps<{
  /**
   * What the page lists, as the word reads mid-sentence: "Finding routes…",
   * "Couldn't load routes.", "No routes match your filters.". One word for
   * all three so the two pages cannot drift into three tones of voice.
   */
  subject: string
  /**
   * The nouns the count line reports, in order - at most two, joined by
   * "and" ("12 climbs and 4 sprints found"). A zero is reported rather than
   * dropped: that a search matched climbs but no sprints is worth reading.
   */
  counts: DiscoveryCount[]
  /** The list fetch's `useFetch` status. */
  status: 'idle' | 'pending' | 'success' | 'error'
}>()

const emit = defineEmits<{ retry: [] }>()

const isLoading = computed(() => props.status === 'pending')
const failed = computed(() => props.status === 'error')
const isEmpty = computed(() => props.counts.every(count => count.value === 0))

const countLine = computed(() =>
  `${props.counts.map(({ value, noun }) => `${value} ${noun}${value === 1 ? '' : 's'}`).join(' and ')} found`
)
</script>

<template>
  <div class="space-y-4">
    <!-- A failed refetch keeps whatever the last successful one left on
         screen and says so above it, the same bargain the ranking pages
         strike: a filter change that fails leaves the previous list readable
         instead of blanking the page under a rider who was reading it. -->
    <p
      v-if="failed"
      class="flex flex-wrap items-center gap-x-2 text-sm text-muted"
      role="alert"
    >
      <UIcon
        name="i-lucide-refresh-cw-off"
        class="size-4 shrink-0"
      />Couldn't load {{ subject }}.
      <UButton
        color="neutral"
        variant="link"
        size="xs"
        class="px-0"
        @click="emit('retry')"
      >
        Try again
      </UButton>
    </p>

    <!-- The live region is always in the DOM: one that appears along with the
         text it holds is announced by nothing.

         A failed fetch reports no count at all. The cards beneath are the
         previous filter's, so a count would be a true statement about what is
         on screen announced as the answer to the filter that was just moved -
         which is the defect the skeleton grid was introduced to end ("the
         stale count above it kept quoting the previous filter's total"). The
         notice above says what actually happened. -->
    <p
      class="text-sm text-muted"
      aria-live="polite"
    >
      <template v-if="isLoading">
        Finding {{ subject }}…
      </template>
      <template v-else-if="!failed">
        {{ countLine }}
      </template>
    </p>

    <slot
      v-if="isLoading"
      name="skeleton"
    />
    <p
      v-else-if="isEmpty && !failed"
      class="text-center py-10 text-muted"
    >
      No {{ subject }} match your filters.
    </p>
    <slot v-else />
  </div>
</template>
