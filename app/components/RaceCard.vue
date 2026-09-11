<script setup lang="ts">
import { ULink } from '#components'
import type { EventRaceWithRoute } from '../../shared/types/events'

/**
 * A Race as a season page lists it (see `CONTEXT.md`): what it is, when it
 * runs, what it is run on, and whether it is the next one or already done.
 * The box, the stat row and the whole-card link are `RouteCard`'s and
 * `SegmentCard`'s, so a season page reads as the same discovery page the
 * homepage and the segments page are.
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
}>()

const href = computed(() => isRacePublishable(props.race) ? `/events/${props.seasonSlug}/${props.race.slug}` : undefined)
// The component itself, not its name: auto-imported components are resolved
// when the template is compiled, so a `:is` naming one as a string renders a
// literal `<ULink>` element that no browser and no crawler understands.
const wrapper = computed(() => href.value ? ULink : 'div')

/**
 * Why a race has no page, in a rider's terms. The two reasons read
 * differently: either the organiser hasn't announced it, or they have and it
 * is run on a course the public catalog doesn't contain (ZRL's unlisted
 * "exclusive" routes), which is a course nothing can be ranked on.
 */
const noPageReason = computed(() => props.race.format && props.race.categories.length
  ? 'this course isn\'t in our route data, so there is nothing to rank on it'
  : 'the organiser hasn\'t published the details yet')

/**
 * One line per course, not one per Category group: where every group rides
 * the same route over the same laps there is only one course to name, and
 * repeating it under each group's label would be three ways of saying the
 * same thing. Where the groups split, each line is labelled with the group
 * it belongs to - that split IS the news.
 */
const courses = computed(() => {
  const groups = hasSplitCourses(props.race)
    ? props.race.categories
    : props.race.categories.slice(0, 1)
  return groups.map(group => ({
    key: formatCategoryGroup(group),
    label: hasSplitCourses(props.race) ? formatCategoryGroup(group) : undefined,
    name: group.routeName ?? group.route?.name,
    worldName: group.route?.worldName,
    // The organiser's own figure first, this site's computed total second -
    // the same rule the race page's header follows, so a rider reads the
    // distance they were told to expect.
    distanceKm: group.officialDistanceKm ?? group.computed?.distanceKm
  }))
})
</script>

<template>
  <component
    :is="wrapper"
    :to="href"
    class="h-full"
  >
    <UCard
      class="h-full"
      :class="href ? 'transition hover:ring-primary/50' : undefined"
      :ui="{ body: 'space-y-3' }"
    >
      <div class="flex items-start justify-between gap-2">
        <!-- `min-w-0` so a long race or round name wraps inside its own
             column instead of widening the card past its grid cell. -->
        <div class="min-w-0">
          <p class="font-semibold text-highlighted">
            {{ raceDisplayName(race) }}
          </p>
          <p class="text-sm text-muted">
            {{ formatRaceDateRange(race.date, race.endDate) }}
          </p>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1.5">
          <UBadge
            v-if="next"
            color="primary"
            variant="subtle"
            icon="i-lucide-flag"
          >
            Next
          </UBadge>
          <UBadge
            v-else-if="past"
            color="neutral"
            variant="subtle"
          >
            Completed
          </UBadge>
          <UBadge
            v-if="race.format"
            :color="RACE_FORMAT_COLORS[race.format]"
            variant="subtle"
          >
            {{ RACE_FORMAT_LABELS[race.format] }}
          </UBadge>
          <UBadge
            v-else
            color="neutral"
            variant="subtle"
          >
            Format TBC
          </UBadge>
        </div>
      </div>

      <div class="space-y-1.5 text-sm">
        <div
          v-for="course in courses"
          :key="course.key"
          class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
        >
          <span
            v-if="course.label"
            class="text-xs font-medium uppercase tracking-wide text-muted"
          >{{ course.label }}</span>
          <span class="text-highlighted">{{ course.name ?? 'Route TBC' }}</span>
          <span
            v-if="course.worldName"
            class="text-muted"
          >{{ course.worldName }}</span>
          <span
            v-if="course.distanceKm"
            class="inline-flex items-center gap-1.5 text-muted tabular-nums"
          ><UIcon
            name="i-lucide-ruler"
            class="size-4 shrink-0"
          />{{ formatDistance(course.distanceKm) }}</span>
        </div>
        <p
          v-if="!courses.length"
          class="text-muted"
        >
          Route TBC
        </p>
      </div>

      <p
        v-if="!href"
        class="text-xs text-muted"
      >
        Details to come - {{ noPageReason }}.
      </p>
    </UCard>
  </component>
</template>
