<script setup lang="ts">
import type { EventSeason } from '../../shared/utils/events'

/**
 * A Season as the events hub lists it (see `CONTEXT.md`): what it is, what
 * the calendar adds up to, and the Rounds it runs over. Same card box as
 * `RouteCard` and `RaceCard`, so the hub reads as the discovery page it is.
 *
 * The card is not one link, because the round tiles are: each is the way
 * into that round of the season page, which is where a rider asking "where
 * are this season's races" is actually going. A card-wide link would swallow
 * them, and a link inside a link is not a thing the HTML allows. So the
 * title is a link in its own right, and styled as one - it was styled as a
 * heading, and nobody could tell it was the way in.
 *
 * One card for current and finished seasons alike - a finished season is
 * still a page, and its races keep their rankings.
 */
const props = defineProps<{
  season: EventSeason
  /**
   * Today, as an ISO date, from whichever page mounted this card - never read
   * here, because the hub is prerendered and a card that asked the clock
   * itself would bake the build date into the shipped HTML. Absent until the
   * page has mounted, and then no round is treated as run: that is the state
   * a crawler sees, with every tile pointing at a round that exists for it.
   */
  today?: string
}>()

const summary = computed(() => summariseSeason(props.season))

/**
 * Where a round tile goes: the season page, at that round. A round that has
 * been run is no longer on that page (see `isRoundRun`, which the season page
 * asks too), so its tile keeps the link and drops the hash rather than
 * pointing at an anchor that isn't there - the rider lands at the top of the
 * season, where the past races are.
 */
function roundHref(round: EventSeason['rounds'][number]): string {
  const season = `/events/${props.season.slug}`
  return props.today && isRoundRun(round, props.today) ? season : `${season}#round-${round.number}`
}
</script>

<template>
  <UCard :ui="{ body: 'space-y-4' }">
    <div>
      <h3 class="text-xl font-semibold">
        <ULink
          :to="`/events/${season.slug}`"
          class="text-primary hover:underline"
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
        />{{ formatSeasonSpan(summary) ?? 'Dates to come' }}
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
      <ULink
        v-for="round in season.rounds"
        :key="round.number"
        :to="roundHref(round)"
        class="rounded-lg border border-default p-3 transition hover:border-primary hover:ring hover:ring-primary/50"
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
      </ULink>
    </div>
  </UCard>
</template>
