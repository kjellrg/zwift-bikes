<script setup lang="ts">
import type { RaceFormatRules } from '../../shared/utils/raceRules'
import type { ScoringRow } from '../../shared/utils/rideStatement'

/**
 * Where a race's points are scored, in the order they are ridden. Three
 * published states, because an empty list is a real one and not a loading
 * failure: the organiser hasn't named the segments yet, the organiser lists
 * none at all, or here they are.
 *
 * A component rather than markup on the race page because it has two homes.
 * Normally it is the Scoring tab of the course analysis, beside the
 * elevation profile its passes are starred on. But a category group whose
 * course isn't in the catalog has no course analysis to put a tab in, and
 * this is organiser data that never needed one - so the race page renders it
 * on its own there, and the two must say the same thing.
 */
const props = defineProps<{
  /**
   * The scoring segments in ride order, already merged across the organiser's
   * FAL and FTS lists and positioned along the ride where the route data says
   * so - see `scoringRows` in the race statement, which owns the lap maths.
   */
  rows: ScoringRow[]
  /** Whether the organiser has yet to publish this group's segments - a different thing from listing none. */
  tbd: boolean
  /** Who publishes them, named in all three states: none of this is ours. */
  organizer: string
  /** The group these rows belong to, for the table's caption. */
  groupLabel: string
  /**
   * This race's format rules. The format travels out on every segment link as
   * `?rules=` so the ranking there is ridden under these rules (#224), and the
   * note under the table says so where the reader is deciding whether to
   * follow one - `segmentLinkNote`.
   */
  rules: RaceFormatRules
}>()

/** Only when the route publishes where its segments sit; otherwise the column would be a row of blanks. */
const hasPositions = computed(() => props.rows.some(row => row.positionsKm.length))
const hasUnlinked = computed(() => props.rows.some(row => !row.slug))
</script>

<template>
  <div class="space-y-3">
    <p
      v-if="tbd"
      class="text-toned"
    >
      <span class="font-medium text-highlighted">To be announced.</span>
      {{ organizer }} hasn't published the scoring segments for this race yet. They're
      added here as soon as they appear.
    </p>
    <p
      v-else-if="!rows.length"
      class="text-toned"
    >
      {{ organizer }} lists no intermediate scoring segments for this race.
    </p>
    <template v-else>
      <p class="text-xs text-muted">
        Points are scored at these segments – <span class="font-medium text-highlighted">FAL</span> by the
        order riders cross the line, <span class="font-medium text-highlighted">FTS</span> by elapsed time
        across the segment.
        <template v-if="hasPositions">
          Every scoring pass is starred on the course profile, in the order you meet it.
        </template>
      </p>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-md">
          <caption class="sr-only">
            Scoring segments for {{ groupLabel }}, in the order they are ridden
          </caption>
          <thead>
            <tr class="border-b border-accented text-left text-xs text-muted">
              <th
                scope="col"
                class="px-2 py-2 font-medium"
              >
                Segment
              </th>
              <th
                scope="col"
                class="px-2 py-2 font-medium"
              >
                FAL
              </th>
              <th
                scope="col"
                class="px-2 py-2 font-medium"
              >
                FTS
              </th>
              <th
                v-if="hasPositions"
                scope="col"
                class="px-2 py-2 font-medium"
              >
                Comes at
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="segment in rows"
              :key="segment.name"
              class="border-b border-default"
            >
              <td class="px-2 py-2.5">
                <!-- Linked only when the segment has a page here. -->
                <!-- `?rules=` carries the race's FORMAT, not its identity:
                     the segment page needs no events data to honour it, and
                     the link doesn't decay when this race retires (#224). -->
                <NuxtLink
                  v-if="segment.slug"
                  :to="`/segments/${segment.slug}?rules=${rules.format}`"
                  class="font-semibold text-highlighted hover:underline"
                >Fastest bike for {{ segment.name }}</NuxtLink>
                <template v-else>
                  {{ segment.name }}
                </template>
              </td>
              <td class="px-2 py-2.5 whitespace-nowrap">
                <span v-if="segment.fal">{{ segment.fal }}x</span>
                <span
                  v-else
                  class="text-muted"
                >-</span>
              </td>
              <td class="px-2 py-2.5 whitespace-nowrap">
                <span v-if="segment.fts">{{ segment.fts }}x</span>
                <span
                  v-else
                  class="text-muted"
                >-</span>
              </td>
              <td
                v-if="hasPositions"
                class="px-2 py-2.5 whitespace-nowrap"
              >
                <span v-if="segment.positionsKm.length">{{ segment.positionsKm.map(km => formatDistance(km)).join(', ') }}</span>
                <span
                  v-else
                  class="text-muted"
                >-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-muted">
        Tap a segment for the fastest bikes over that sprint alone – the fastest bike for a sprint
        isn't always the fastest over a whole race. {{ rules.segmentLinkNote }}
      </p>
      <p
        v-if="hasUnlinked"
        class="text-xs text-muted"
      >
        Segments without a link aren't in this site's segment catalog yet – it's built from routes
        that publish where each segment sits along them, and this one doesn't.
      </p>
    </template>
  </div>
</template>
