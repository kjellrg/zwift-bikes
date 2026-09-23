<script setup lang="ts">
import type { PublishableRace } from '../../shared/utils/events'

/**
 * The "Next race" strip on the events hub: the next upcoming publishable
 * race across every series, in one row - its name, course, dates and format
 * - with a link that reads as the question a rider would ask of it. Not a
 * card: nothing is a card that is not a thing to open. The homepage has no
 * strip: its example card shows the same race, with the answer drawn.
 *
 * Resolved in `onMounted`, never at render time - the hub is prerendered,
 * so "next" evaluated during the build would be frozen into the shipped
 * HTML. Hidden until mounted and whenever nothing is upcoming, so it
 * costs the page nothing when the calendars run dry.
 */
// Loaded here rather than by the host page, which has no other reason to
// touch preferences: this card hides itself when the rider has switched the
// teasers off.
const { showUpcomingRaces, load: loadPreferences } = usePreferences()

// Hides with the events section (runtime site flags) - a teaser must not
// link into a section whose pages and data are gated off. Loaded here too
// (idempotently, like preferences) so the card is correct even if a future
// layout stops loading the flags itself.
const { eventsVisible, load: loadSiteFlags } = useSiteFlags()

const nextRace = ref<PublishableRace>()
// Until mounted the card's space is held by a same-height skeleton: the
// real card cannot be server-rendered (see above), and letting it pop in
// after hydration pushed everything under it down.
// The skeleton collapses only when there is nothing to show - teasers off,
// events gated, or the calendars run dry - which is the rare case.
const mounted = ref(false)
onMounted(() => {
  loadPreferences()
  loadSiteFlags()
  nextRace.value = getNextUpcomingRace(new Date().toISOString().slice(0, 10))
  mounted.value = true
})

const courseNames = computed(() => {
  if (!nextRace.value) return ''
  return [...new Set(nextRace.value.race.categories.map(group => group.routeName).filter(Boolean))].join(' & ')
})
</script>

<template>
  <div
    v-if="!mounted"
    class="flex h-[3.25rem] items-center gap-5 rounded-xl border border-default bg-elevated px-4.5"
    aria-hidden="true"
  >
    <USkeleton class="h-4 w-16" />
    <USkeleton class="h-4 w-72 max-w-full" />
  </div>
  <section
    v-else-if="showUpcomingRaces && eventsVisible && nextRace"
    aria-label="Next race"
    class="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-default bg-elevated px-4.5 py-3.5 text-md"
  >
    <span class="text-sm text-muted">Next race</span>
    <span class="text-toned">
      <span class="font-semibold text-highlighted">{{ raceContextLabel(nextRace.season, nextRace.round) }} {{ raceDisplayName(nextRace.race) }}</span><template v-if="courseNames">
        on {{ courseNames }}
      </template>
    </span>
    <span class="text-toned">
      {{ formatRaceDateRange(nextRace.race.date, nextRace.race.endDate) }}<template v-if="nextRace.race.format">
        · {{ RACE_FORMAT_LABELS[nextRace.race.format] }}
      </template>
    </span>
    <NuxtLink
      :to="nextRace.path"
      class="font-medium whitespace-nowrap text-primary hover:underline sm:ml-auto"
    >
      Fastest bike for it
    </NuxtLink>
  </section>
</template>
