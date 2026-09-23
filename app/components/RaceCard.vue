<script setup lang="ts">
import type { EventRaceWithRoute } from '../../shared/types/events'
import type { Silhouette } from '#shared/utils/silhouette'

/**
 * A Race as a season page schedules it (see `CONTEXT.md`): one row with its
 * date, its primary route's Silhouette, what it is and what it is run on,
 * its format as text, and "Fastest bike for it" - a schedule reads as a
 * schedule, and a race with several Category groups still fits, one course
 * line per distinct course.
 *
 * One card shape for upcoming and completed races. They used to be two
 * tables with different columns, so a race quietly lost its distance and
 * gained a different name the day its date passed - a rider looking up what
 * they rode last week saw less than the rider who looked the week before.
 *
 * A race the organiser hasn't finished announcing is the same card without a
 * link: `isRacePublishable` is what decides, because a race with no format or
 * no known course has no page to go to - so it says what is known, says the
 * rest is to come, and does not pretend to be a destination.
 */
const props = defineProps<{
  race: EventRaceWithRoute
  seasonSlug: string
  /** The first race still to be run in this season - one per season, from the client's clock. */
  next?: boolean
  /** Already run. Both flags are resolved post-mount; see the season page. */
  past?: boolean
  /** The primary route's Silhouette, when the route has a measured shape. */
  shape?: Silhouette
}>()

const href = computed(() => isRacePublishable(props.race) ? `/events/${props.seasonSlug}/${props.race.slug}` : undefined)

/**
 * Why a race has no page, in a rider's terms. The two reasons read
 * differently: either the organiser hasn't announced it, or they have and it
 * is run on a course the public catalog doesn't contain (ZRL's unlisted
 * "exclusive" routes), which is a course nothing can be ranked on.
 *
 * Keyed on a named course rather than on `categories.length`, because a group
 * can exist with no course named at all - and telling that rider the course
 * is missing from our data would blame us for a schedule the organiser hasn't
 * published. This has to move with `isRacePublishable`, which is what
 * actually decides there is no page: a new condition there without one here
 * leaves this sentence naming the wrong culprit.
 */
const noPageReason = computed(() => props.race.format && courses.value.some(course => course.name)
  ? 'this course isn\'t in our route data, so there is nothing to rank on it'
  : 'the organiser hasn\'t published the details yet')

/**
 * One line per distinct course, not one per Category group: where every group
 * rides the same route over the same distance there is one course to name,
 * and repeating it under each group's label would be three ways of saying the
 * same thing. Groups that differ in any of it get a line each, labelled -
 * that split IS the news, and it is why the lines are collapsed on what they
 * actually show rather than on `hasSplitCourses`: two groups can share a
 * route and a lap count and still be published at different distances.
 */
const courses = computed(() => {
  const byLine = new Map<string, { labels: string[], name?: string, worldName?: string, distanceKm?: number }>()
  for (const group of props.race.categories) {
    const line = {
      name: group.routeName ?? group.route?.name,
      worldName: group.route?.worldName,
      // The organiser's own figure first, this site's computed total second -
      // the same rule the race page's header follows, so a rider reads the
      // distance they were told to expect.
      distanceKm: group.officialDistanceKm ?? group.computed?.distanceKm
    }
    const key = `${line.name ?? ''}#${line.worldName ?? ''}#${line.distanceKm ?? ''}`
    const entry = byLine.get(key) ?? { labels: [], ...line }
    entry.labels.push(formatCategoryGroup(group))
    byLine.set(key, entry)
  }
  const lines = [...byLine.values()]
  return lines.map(line => ({
    ...line,
    key: line.labels.join(', '),
    // A race with one course to its name doesn't need telling whose it is.
    label: lines.length > 1 ? line.labels.join(', ') : undefined
  }))
})
</script>

<template>
  <li class="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 border-b border-default py-4 sm:grid-cols-[5.5rem_7rem_minmax(0,1fr)_auto] sm:items-center">
    <p class="text-sm text-toned">
      {{ formatRaceDateRange(race.date, race.endDate) }}
      <span
        v-if="next || past"
        class="block text-xs text-muted"
      >{{ next ? 'Next race' : 'Completed' }}</span>
    </p>
    <!-- No route yet, no drawing: an empty slot keeps the schedule's columns. -->
    <RouteSilhouette
      v-if="shape"
      :shape="shape"
      class="hidden h-10 sm:block"
    />
    <span
      v-else
      class="hidden sm:block"
    />
    <div class="min-w-0">
      <p class="font-semibold text-highlighted">
        {{ raceDisplayName(race) }}
        <span class="ml-1 text-sm font-normal text-muted">{{ race.format ? RACE_FORMAT_LABELS[race.format] : 'Format to come' }}</span>
      </p>
      <p
        v-for="course in courses"
        :key="course.key"
        class="text-sm text-toned"
      >
        <span
          v-if="course.label"
          class="text-muted"
        >{{ course.label }}: </span>{{ [course.name ?? 'Route to come', course.worldName].filter(Boolean).join(', ') }}{{ course.distanceKm ? ` · ${formatDistance(course.distanceKm)}` : '' }}
      </p>
      <p
        v-if="!courses.length"
        class="text-sm text-muted"
      >
        Route to come
      </p>
    </div>
    <p class="col-start-2 text-sm sm:col-start-auto sm:text-right">
      <NuxtLink
        v-if="href"
        :to="href"
        class="font-medium whitespace-nowrap text-primary hover:underline"
      >
        Fastest bike for it
      </NuxtLink>
      <span
        v-else
        class="text-muted"
      >Details to come - {{ noPageReason }}.</span>
    </p>
  </li>
</template>
