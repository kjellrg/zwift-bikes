<script setup lang="ts">
/**
 * Hub for the racing calendars this site covers. Imports the calendar module
 * directly rather than fetching it - `shared/utils/events` is a leaf (plain
 * dates and strings, no route surface data), so there's nothing here worth
 * an API round trip.
 */
const seasons = getSeasons()

const siteConfig = useSiteConfig()

useSeoMeta({
  title: 'Zwift Race Calendars - Best Bike per Race | Zwift Best Bike',
  description: 'Race dates, routes and the fastest bike and wheel combo for every round of Zwift Racing League.',
  ogTitle: 'Zwift race calendars',
  ogDescription: 'Race dates, routes and the fastest bike and wheel combo for every round of Zwift Racing League.'
})

useHead({
  script: [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
        { '@type': 'ListItem', 'position': 2, 'name': 'Race calendars', 'item': `${siteConfig.url}/events` }
      ]
    }).replace(/</g, '\\u003c')
  }]
})
</script>

<template>
  <UContainer class="py-10 space-y-10">
    <div>
      <UButton
        to="/"
        variant="link"
        color="neutral"
        icon="i-lucide-arrow-left"
        class="mb-4 px-0"
      >
        Back to all routes
      </UButton>
      <h1 class="text-3xl font-bold text-highlighted">
        Zwift race calendars
      </h1>
      <p class="text-muted mt-2 max-w-2xl">
        Every race day, the route it's run on, and the bike and wheel combo our physics model makes
        fastest for it - with the lap count and equipment rules the organisers actually set.
      </p>
    </div>

    <div class="space-y-4">
      <!-- Reachable by hiding every season - rare, but an empty page with a
           heading and nothing under it reads as broken rather than deliberate. -->
      <p
        v-if="!seasons.length"
        class="text-muted"
      >
        No race calendars are being tracked at the moment. Check back when the next season is announced.
      </p>

      <UCard
        v-for="season in seasons"
        :key="season.slug"
      >
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold text-highlighted">
              <ULink
                :to="`/events/${season.slug}`"
                class="hover:text-primary"
              >
                {{ season.seriesName }} {{ season.label }}
              </ULink>
            </h2>
            <p class="text-muted mt-1 max-w-2xl">
              {{ season.description }}
            </p>
          </div>
          <UBadge
            color="neutral"
            variant="subtle"
          >
            {{ season.organizer }}
          </UBadge>
        </div>

        <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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

        <div class="mt-4">
          <UButton
            :to="`/events/${season.slug}`"
            color="primary"
            variant="subtle"
            trailing-icon="i-lucide-arrow-right"
          >
            See the {{ season.label }} calendar
          </UButton>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
