<script setup lang="ts">
import type { EventRaceWithRoute } from '../../shared/types/events'
import { NuxtLink } from '#components'
import type { Silhouette } from '#shared/utils/silhouette'

/**
 * A Race as a season page schedules it (see `CONTEXT.md`): one row with its
 * date, its primary route's Silhouette, what it is and what it is run on,
 * its format as text, and a chevron where it leads to "Fastest bike for it" -
 * a schedule reads as a schedule, and a race with several Category groups still fits, one course
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
   * that mixes seasons - the events hub's. A season page names its series
   * once, in its heading.
   */
  tag?: string
  /** The theme of the race's monthly round ("Tour of Watopia"), said after its name on the hub, where a bare "Stage 1" would not say which. */
  theme?: string
  /**
   * How far off the race is, under its date: "in 5 days", "ends Sun" (see
   * `relativeRaceDay`). The hub passes it once the page is on the rider's
   * screen and not before, since the served HTML is the build's.
   */
  when?: string
  /**
   * Listed under its own round's heading, which already says "Round 1", so
   * the row says "Week 2" (`raceNameInRound`). The link's name keeps the full
   * one: a list of links is also heard away from the headings above it.
   */
  inRound?: boolean
}>()

const href = computed(() => isRacePublishable(props.race) ? `/events/${props.seasonSlug}/${props.race.slug}` : undefined)

const name = computed(() => [props.tag, raceDisplayName(props.race), props.theme && `(${props.theme})`].filter(Boolean).join(' '))
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
const linkLabel = computed(() => `${name.value}, ${dates.value} – Fastest bike for it`)

/**
 * Why a race has no page, in a rider's terms. The two reasons read
 * differently: either the organiser hasn't announced it, or they have and it
 * is run on a course the public catalog doesn't contain (ZRL's unlisted
 * "exclusive" routes), which is a course nothing can be ranked on.
 *
 * `isOnUnknownCourse` tells the two apart, the same test a hub series box
 * names such a race by, and it asks `isRacePublishable`, which is what
 * actually decides there is no page.
 */
const noPageReason = computed(() => isOnUnknownCourse(props.race)
  ? 'this course isn\'t in our route data, so there is nothing to rank on it'
  : 'the organiser hasn\'t published the details yet')

const courses = computed(() => raceCourseLines(props.race))
</script>

<template>
  <!-- One row, one link: a race with a page is a way in across its whole
       width, a race without one is the same row standing still. The rule and
       the hover stop at the content edge, in line with the round heading's
       rule; a linked row ends in a chevron that turns primary on hover, and
       the link's accessible name (`linkLabel`) carries what it leads to. -->
  <li class="border-b border-default">
    <component
      :is="href ? NuxtLink : 'div'"
      :to="href"
      :aria-label="href ? linkLabel : undefined"
      class="grid grid-cols-[minmax(0,1fr)_4rem] gap-x-4 gap-y-2 py-4 sm:grid-cols-[7.5rem_7rem_minmax(0,1fr)_auto] sm:items-center"
      :class="href && 'group focus-visible:outline-offset-2'"
    >
      <p class="text-sm font-medium font-heading whitespace-nowrap text-toned">
        {{ dates }}
        <span
          v-if="next"
          class="text-xs font-normal font-sans text-muted sm:block"
        ><span class="sm:hidden"> · </span>Next race</span>
        <span
          v-if="when"
          class="text-xs font-normal font-sans text-muted sm:block"
        ><span class="sm:hidden"> · </span>{{ when }}</span>
      </p>
      <!-- No route yet, no drawing: an empty slot keeps the schedule's columns. -->
      <RouteSilhouette
        v-if="shape"
        :shape="shape"
        class="col-start-2 row-start-1 h-10 w-16 sm:col-start-auto sm:row-start-auto sm:w-auto"
      />
      <span
        v-else
        class="hidden sm:block"
      />
      <div class="col-start-1 min-w-0 sm:col-start-auto">
        <p class="font-semibold text-highlighted">
          <span
            v-if="tag"
            class="mr-1.5 text-sm font-normal text-toned"
          >{{ tag }}</span>{{ shownName }}
          <span
            v-if="theme"
            class="ml-1 text-sm font-normal text-toned"
          >{{ theme }}</span>
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
      <p
        v-if="href"
        class="col-start-2 row-start-2 justify-self-end sm:col-start-auto sm:row-start-auto"
        aria-hidden="true"
      >
        <UIcon
          name="i-lucide-chevron-right"
          class="size-5 text-muted transition-colors group-hover:text-primary"
        />
      </p>
      <p
        v-else
        class="col-span-2 text-sm text-muted sm:col-span-1 sm:text-right"
      >
        Details to come – {{ noPageReason }}.
      </p>
    </component>
  </li>
</template>
