<script setup lang="ts">
import type { PublishableRace } from '../../shared/utils/events'

/**
 * The homepage's "Next race" teaser: the next upcoming publishable race
 * across every series, linking to its race page.
 *
 * Resolved in `onMounted`, never at render time - the homepage is
 * prerendered, so "next" evaluated during the build would be frozen into the
 * shipped HTML. Hidden until mounted and whenever nothing is upcoming, so it
 * costs the page nothing when the calendars run dry.
 */
// Loaded here rather than by the host page: the homepage has no other
// reason to touch preferences, and this card hides itself when the rider
// has switched the teasers off.
const { showUpcomingRaces, load: loadPreferences } = usePreferences()

// Hides with the events section (runtime site flags) - a teaser must not
// link into a section whose pages and data are gated off. Loaded here too
// (idempotently, like preferences) so the card is correct even if a future
// layout stops loading the flags itself.
const { eventsVisible, load: loadSiteFlags } = useSiteFlags()

const nextRace = ref<PublishableRace>()
// Until mounted the card's space is held by a same-height skeleton: the
// real card cannot be server-rendered (see above), and letting it pop in
// after hydration pushed the whole route grid down on the most-visited page.
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
  <UCard
    v-if="!mounted"
    aria-hidden="true"
  >
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div class="space-y-2">
        <USkeleton class="h-3 w-16" />
        <USkeleton class="h-5 w-72 max-w-full" />
        <USkeleton class="h-4 w-48" />
      </div>
      <USkeleton class="h-8 w-32" />
    </div>
  </UCard>
  <UCard v-else-if="showUpcomingRaces && eventsVisible && nextRace">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <p class="text-xs text-muted uppercase tracking-wide">
          Next race
        </p>
        <p class="font-semibold text-highlighted">
          {{ raceContextLabel(nextRace.season, nextRace.round) }} - {{ raceDisplayName(nextRace.race) }}<template v-if="courseNames">
            on {{ courseNames }}
          </template>
        </p>
        <p class="text-sm text-muted">
          {{ formatRaceDateRange(nextRace.race.date, nextRace.race.endDate) }}<template v-if="nextRace.race.format">
            - {{ RACE_FORMAT_LABELS[nextRace.race.format] }}
          </template>
        </p>
      </div>
      <UButton
        :to="nextRace.path"
        color="primary"
        variant="subtle"
        trailing-icon="i-lucide-arrow-right"
      >
        Best bike for it
      </UButton>
    </div>
  </UCard>
</template>
