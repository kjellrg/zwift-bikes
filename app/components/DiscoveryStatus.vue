<script setup lang="ts">
import type { DiscoveryCount } from '../utils/discoveryCounts'

/**
 * What a discovery page (see `CONTEXT.md`) says about its own list: how many
 * Rides matched, that they are still being fetched, that none matched, or
 * that the fetch failed. The filter rows above it stay on the pages - the
 * homepage has ranges and a surface, the segments page a kind, and they share
 * not one control - but the states a list can be in are the same on each of
 * them, and one component is how they stay one vocabulary instead of three.
 *
 * The matched Rides come through the default slot and the shape they load
 * into through `#skeleton`: world groups on the segments page, round groups
 * on a season page. Which of the two is on screen is decided here, so no page
 * has to spell out that a skeleton and an empty message are mutually
 * exclusive. The homepage fetches nothing when a filter moves - it filters
 * the cards its payload carries (#262) - so it passes no status, and its list
 * is never loading and never failed.
 *
 * The empty branch belongs to the pages that have filters, and says so - "No
 * routes match your filters". A season page has none, so it does not render
 * this component at all once its calendar is loaded and has nothing upcoming:
 * a season being over is an answer in its own words, not a search that
 * matched nothing. See `showsStatus` in `pages/events/[season]/index.vue`.
 */

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
  /** The list fetch's `useFetch` status; none for a list already in hand. */
  status?: 'idle' | 'pending' | 'success' | 'error'
  /**
   * Whether the page prints the count line itself, beside its filters - the
   * homepage and the segments page keep the count on the filter row, so the
   * number sits with the controls that produced it. The words are the same
   * either way: both come from `discoveryCountLine`.
   */
  countElsewhere?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()

const isLoading = computed(() => props.status === 'pending')
const failed = computed(() => props.status === 'error')
const isEmpty = computed(() => props.counts.every(count => count.value === 0))

const countLine = computed(() => discoveryCountLine(props.counts))
</script>

<template>
  <div class="space-y-4">
    <!-- A failed refetch keeps whatever the last successful one left on
         screen and says so above it, the same bargain the ranking pages
         strike: a filter change that fails leaves the previous list readable
         instead of blanking the page under a rider who was reading it. -->
    <SiteNotice
      v-if="failed"
      tone="error"
      role="alert"
    >
      <p>Couldn't load {{ subject }}.</p>
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          size="xs"
          icon="i-lucide-rotate-cw"
          @click="emit('retry')"
        >
          Try again
        </UButton>
      </template>
    </SiteNotice>

    <!-- The live region is always in the DOM: one that appears along with the
         text it holds is announced by nothing. A failed fetch reports no
         count: the cards beneath are the previous filter's, and a count would
         announce them as the answer to the filter just moved. -->
    <p
      v-if="!countElsewhere"
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
      class="py-10 text-muted"
    >
      No {{ subject }} match your filters. Loosen one, or reset them.
    </p>
    <slot v-else />
  </div>
</template>
