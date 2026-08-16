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

const nextRace = ref<PublishableRace>()
onMounted(() => {
  loadPreferences()
  nextRace.value = getNextUpcomingRace(new Date().toISOString().slice(0, 10))
})

const courseNames = computed(() => {
  if (!nextRace.value) return ''
  return [...new Set(nextRace.value.race.categories.map(group => group.routeName).filter(Boolean))].join(' & ')
})
</script>

<template>
  <UCard v-if="showUpcomingRaces && nextRace">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <p class="text-xs text-muted uppercase tracking-wide">
          Next race
        </p>
        <p class="font-semibold text-highlighted">
          {{ nextRace.season.seriesName }} {{ nextRace.season.label }} - {{ raceDisplayName(nextRace.race) }}<template v-if="courseNames">
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
