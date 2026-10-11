<script setup lang="ts">
import { noMatchHeadline } from '../utils/homeSearch'

/**
 * What the homepage search says when a term finds no route (#331), in the
 * search's dropdown and again above the route grid: the term itself, the
 * climbs and sprints it did name, the route names it came closest to, and a
 * way out - the segments page, or Reset - so a search never ends on a bare
 * "0 found".
 *
 * `segmentsChecked` is whether the segments were there to search: they are
 * fetched the first time the search is used, and until they arrive the
 * message claims only what it knows - that no route has the name.
 */
const props = withDefaults(defineProps<{
  term: string
  near: readonly { slug: string, name: string }[]
  /** The climbs and sprints the term did name - the grid lists routes only, so it can only point to them. */
  segments?: readonly { slug: string, name: string }[]
  segmentsChecked: boolean
}>(), { segments: () => [] })

const emit = defineEmits<{ reset: [] }>()

const headline = computed(() => noMatchHeadline(props.term, props.segmentsChecked && !props.segments.length))

/** What follows an item of a listed sentence: ", ", " or " before the last, and `end` after it. */
const separator = (index: number, count: number, end: string) => index < count - 2 ? ', ' : index === count - 2 ? ' or ' : end
</script>

<template>
  <div class="space-y-2 text-sm text-toned">
    <p class="font-medium text-highlighted">
      {{ headline }}
    </p>
    <p v-if="segments.length">
      Climbs and sprints by that name:
      <template
        v-for="(segment, index) in segments"
        :key="segment.slug"
      >
        <NuxtLink
          :to="`/segments/${segment.slug}`"
          class="text-primary underline decoration-primary/40 hover:decoration-primary"
        >{{ segment.name }}</NuxtLink>{{ separator(index, segments.length, '.') }}
      </template>
    </p>
    <p v-if="near.length">
      Did you mean
      <template
        v-for="(route, index) in near"
        :key="route.slug"
      >
        <NuxtLink
          :to="`/routes/${route.slug}`"
          class="text-primary underline decoration-primary/40 hover:decoration-primary"
        >{{ route.name }}</NuxtLink>{{ separator(index, near.length, '?') }}
      </template>
    </p>
    <p class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <NuxtLink
        to="/segments"
        class="text-primary underline decoration-primary/40 hover:decoration-primary"
      >Browse climbs and sprints</NuxtLink>
      <UButton
        color="neutral"
        variant="outline"
        size="xs"
        icon="i-lucide-rotate-ccw"
        @click="emit('reset')"
      >
        Reset
      </UButton>
    </p>
  </div>
</template>
