<script setup lang="ts">
import type { EventSeason } from '../../shared/utils/events'

/**
 * A Season as the events hub lists it (see `CONTEXT.md`): what it is, what
 * the calendar adds up to, and the rounds it runs over. Same card box as
 * `RouteCard` and `RaceCard`, so the hub reads as the discovery page it is.
 *
 * The title is the link, not the whole card: the round tiles beneath are the
 * substance of the card and a rider reads them in place, so a card-wide
 * hit area would swallow that reading into one destination. (A `RaceCard`
 * has nothing to read past its own summary, which is why that one is a link
 * end to end.)
 *
 * One card for current and finished seasons alike - a finished season is
 * still a page, and its races keep their rankings.
 */
const props = defineProps<{
  season: EventSeason
}>()

const summary = computed(() => summariseSeason(props.season))
</script>

<template>
  <UCard :ui="{ body: 'space-y-4' }">
    <div>
      <h3 class="text-xl font-semibold text-highlighted">
        <ULink
          :to="`/events/${season.slug}`"
          class="hover:text-primary"
        >
          {{ season.seriesName }} {{ season.label }}
        </ULink>
      </h3>
      <p class="text-muted mt-1 max-w-2xl">
        {{ season.description }}
      </p>
    </div>

    <!-- The numbers a rider scans a season by, in the stat row every card on
         a discovery page uses. A season with nothing announced yet has no
         span to report and says so rather than printing an empty dash. -->
    <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
      <span class="inline-flex items-center gap-2">
        <UIcon
          name="i-lucide-calendar-days"
          class="size-4 shrink-0"
        />{{ summary.startDate && summary.endDate
          ? `${formatRaceDateShort(summary.startDate)} - ${formatRaceDateShort(summary.endDate)}`
          : 'Dates to come' }}
      </span>
      <span class="inline-flex items-center gap-2">
        <UIcon
          name="i-lucide-layers"
          class="size-4 shrink-0"
        />{{ summary.rounds }} round{{ summary.rounds === 1 ? '' : 's' }}
      </span>
      <span class="inline-flex items-center gap-2">
        <UIcon
          name="i-lucide-flag"
          class="size-4 shrink-0"
        />{{ summary.races }} race{{ summary.races === 1 ? '' : 's' }}
      </span>
    </div>

    <div
      v-if="season.rounds.length"
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
    >
      <div
        v-for="round in season.rounds"
        :key="round.number"
        class="rounded-lg border border-default p-3"
      >
        <p class="text-xs text-muted uppercase tracking-wide">
          Round {{ round.number }}
        </p>
        <p class="font-medium text-highlighted">
          {{ round.name ?? `Round ${round.number}` }}
        </p>
        <p class="text-sm text-muted">
          {{ formatRaceDateShort(round.startDate) }} - {{ formatRaceDateShort(round.endDate) }}
        </p>
      </div>
    </div>
  </UCard>
</template>
