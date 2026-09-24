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
 * Only a season still being run gets a card: the hub leaves out one that has
 * been (`seasonHasBeenRun`).
 */
const props = defineProps<{
  season: EventSeason
  /**
   * Today, as an ISO date, from the page that lists this card - never read
   * here, so the hub and its cards answer "has it been run" off one clock
   * (`useToday`).
   */
  today: string
}>()

const summary = computed(() => summariseSeason(props.season))

/**
 * Each round tile still ahead of the rider, with where it stands. A round that
 * has been run has no tile: it is no longer on the season page (see
 * `roundState`, which that page asks too), and this site has nothing left to
 * say about it. So every tile is a way into its round of the season page.
 *
 * Where it stands is a quiet word beside its number, on now or to come -
 * text, never a coloured badge.
 */
const roundTiles = computed(() => props.season.rounds
  .map(round => ({ round, state: roundState(round, props.today) }))
  .filter(tile => tile.state !== 'past'))
</script>

<template>
  <article class="rounded-xl border border-default bg-elevated p-5">
    <h3 class="text-xl font-semibold font-heading">
      <NuxtLink
        :to="`/events/${season.slug}`"
        class="text-highlighted underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
      >
        {{ season.seriesName }} {{ season.label }}
      </NuxtLink>
    </h3>
    <p class="mt-1 max-w-2xl text-toned">
      {{ season.description }}
    </p>

    <!-- The numbers a rider scans a season by. A season with nothing
         announced yet has no span and says so rather than printing a dash. -->
    <p class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-toned">
      <span>{{ formatSeasonSpan(summary) ?? 'Dates to come' }}</span>
      <span><span class="font-semibold text-highlighted">{{ summary.rounds }}</span> round{{ summary.rounds === 1 ? '' : 's' }}</span>
      <span><span class="font-semibold text-highlighted">{{ summary.races }}</span> race{{ summary.races === 1 ? '' : 's' }}</span>
    </p>

    <ul
      v-if="roundTiles.length"
      class="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
    >
      <li
        v-for="tile in roundTiles"
        :key="tile.round.number"
      >
        <NuxtLink
          :to="`/events/${season.slug}#round-${tile.round.number}`"
          class="block h-full rounded-lg border border-default px-3 py-2.5 transition-colors hover:border-accented"
        >
          <span class="flex items-baseline justify-between gap-2 text-xs text-muted">
            <span>Round {{ tile.round.number }}</span>
            <span>{{ tile.state === 'ongoing' ? 'Ongoing' : 'To come' }}</span>
          </span>
          <span class="mt-0.5 block font-medium text-highlighted">
            {{ tile.round.name ?? `Round ${tile.round.number}` }}
          </span>
          <span class="block text-sm text-muted">
            {{ formatRaceDateShort(tile.round.startDate) }} - {{ formatRaceDateShort(tile.round.endDate) }}
          </span>
        </NuxtLink>
      </li>
    </ul>
  </article>
</template>
