<script setup lang="ts">
import type { EventRaceWithRoute } from '../../shared/types/events'
import { NuxtLink } from '#components'
import type { Silhouette } from '#shared/utils/silhouette'

/**
 * A Race as a season page schedules it (see `CONTEXT.md`): one row with its
 * date, its primary route's Silhouette, what it is and what it is run on,
 * its format as text, and "Fastest bike for it" - a schedule reads as a
 * schedule, and a race with several Category groups still fits, one course
 * line per distinct course.
 *
 * A race with a page is one link across the whole row, not just its cue: the
 * row is the thing a rider picks, so anywhere on it is the way in. A race the
 * organiser hasn't finished announcing is the same card without a link or a
 * hover: `isRacePublishable` is what decides, because a race with no format
 * or no known course has no page to go to - so it says what is known, says
 * the rest is to come, and does not pretend to be a destination.
 */
const props = defineProps<{
  race: EventRaceWithRoute
  seasonSlug: string
  /** The first race still to be run in this season - one per season. A race that has been run is not listed at all. */
  next?: boolean
  /** The primary route's Silhouette, when the route has a measured shape. */
  shape?: Silhouette
  /**
   * A short series name set in front of the race's own ("ZRL"), for a list
   * that mixes seasons. A season page names its series once, in its heading.
   */
  tag?: string
  /**
   * Listed under its own round's heading, which already says "Round 1", so
   * the row says "Week 2" (`raceNameInRound`). The link's name keeps the full
   * one: a list of links is also heard away from the headings above it.
   */
  inRound?: boolean
}>()

const href = computed(() => isRacePublishable(props.race) ? `/events/${props.seasonSlug}/${props.race.slug}` : undefined)

const name = computed(() => [props.tag, raceDisplayName(props.race)].filter(Boolean).join(' '))
const shownName = computed(() => props.inRound ? raceNameInRound(props.race) : raceDisplayName(props.race))
const dates = computed(() => formatRaceDateRange(props.race.date, props.race.endDate))

/**
 * What the row's one link is called. Its content is the whole row - date,
 * status, course lines and all - which is too much to hear as a link's name,
 * and the visible cue alone, "Fastest bike for it", would leave a list of
 * links all saying the same thing. So it is the race and its dates, then the
 * cue a rider sees, which keeps what a speech-control user reads on screen
 * inside the name they can say - "Week 2" is inside "Round 1 Week 2".
 */
const linkLabel = computed(() => `${name.value}, ${dates.value} - Fastest bike for it`)

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
const noPageReason = computed(() => props.race.format && props.race.categories.some(group => group.routeName ?? group.route?.name)
  ? 'this course isn\'t in our route data, so there is nothing to rank on it'
  : 'the organiser hasn\'t published the details yet')

const courses = computed(() => raceCourseLines(props.race))
</script>

<template>
  <!-- One row, one link: a race with a page is a way in across its whole
       width, a race without one is the same row standing still. The negative
       margin lets the hover tint reach past the text without moving it off
       the round heading's edge. -->
  <li class="-mx-3 border-b border-default">
    <component
      :is="href ? NuxtLink : 'div'"
      :to="href"
      :aria-label="href ? linkLabel : undefined"
      class="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md px-3 py-4 sm:grid-cols-[5.5rem_7rem_minmax(0,1fr)_auto] sm:items-center"
      :class="href && 'group transition-colors hover:bg-elevated focus-visible:outline-offset-0'"
    >
      <p class="text-sm text-toned">
        {{ dates }}
        <span
          v-if="next"
          class="block text-xs text-muted"
        >Next race</span>
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
          <span
            v-if="tag"
            class="mr-1.5 text-sm font-medium text-muted"
          >{{ tag }}</span>{{ shownName }}
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
          >{{ course.label }}: </span>{{ course.place }}<template v-if="course.figures">
            · <span class="whitespace-nowrap">{{ course.figures }}</span>
          </template>
        </p>
        <p
          v-if="!courses.length"
          class="text-sm text-muted"
        >
          Route to come
        </p>
      </div>
      <p class="col-start-2 text-sm sm:col-start-auto sm:text-right">
        <span
          v-if="href"
          class="font-medium whitespace-nowrap text-primary group-hover:underline"
        >Fastest bike for it</span>
        <span
          v-else
          class="text-muted"
        >Details to come - {{ noPageReason }}.</span>
      </p>
    </component>
  </li>
</template>
