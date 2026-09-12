<script setup lang="ts">
import { ULink } from '#components'
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
 * Each round tile, with where it stands and where it goes.
 *
 * A run round is not a link at all: it is no longer on the season page (see
 * `roundState`, which that page asks too), and its races are inside a
 * disclosure a link cannot open - so a tile that pointed there landed a rider
 * at the top of the page with nothing to show for the click. It says "Past"
 * and leaves them to the disclosure, which is as much as this site owes a
 * race that has been run. It is not dimmed: a tile at 75% opacity put its
 * text under 3:1 on the light ground, and the badge and the muted name
 * already say what the fade said.
 *
 * Only the two exceptional states are badged. A round still to come is the
 * default and carries its dates already; badging it too would put a chip on
 * every tile of every card and drown the one a rider is looking for.
 */
const roundTiles = computed(() => props.season.rounds.map((round) => {
  const state = props.today ? roundState(round, props.today) : 'upcoming'
  return {
    round,
    state,
    to: state === 'past' ? undefined : `/events/${props.season.slug}#round-${round.number}`
  }
}))
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
      <component
        :is="tile.to ? ULink : 'div'"
        v-for="tile in roundTiles"
        :key="tile.round.number"
        :to="tile.to"
        class="rounded-lg border border-default p-3"
        :class="tile.to && 'transition hover:border-primary hover:ring hover:ring-primary/50'"
      >
        <div class="flex items-baseline justify-between gap-2">
          <p class="text-xs text-muted uppercase tracking-wide">
            Round {{ tile.round.number }}
          </p>
          <UBadge
            v-if="tile.state === 'ongoing'"
            color="primary"
            variant="subtle"
            size="sm"
          >
            Ongoing
          </UBadge>
          <UBadge
            v-else-if="tile.state === 'past'"
            color="neutral"
            variant="subtle"
            size="sm"
          >
            Past
          </UBadge>
        </div>
        <p
          class="font-medium"
          :class="tile.state === 'past' ? 'text-muted' : 'text-highlighted'"
        >
          {{ tile.round.name ?? `Round ${tile.round.number}` }}
        </p>
        <p class="text-sm text-muted">
          {{ formatRaceDateShort(tile.round.startDate) }} - {{ formatRaceDateShort(tile.round.endDate) }}
        </p>
      </component>
    </div>
  </UCard>
</template>
