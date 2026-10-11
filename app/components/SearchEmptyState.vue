<script setup lang="ts">
/**
 * What the homepage search says when a term finds nothing (#331), in the
 * search's dropdown and again above the route grid: the term itself, the
 * route names it came closest to, and a way out - the segments page, or
 * Reset - so a search never ends on a bare "0 found".
 *
 * `segmentsChecked` is whether the segments were there to search: they are
 * fetched the first time the search is used, and until they arrive the
 * message claims only what it knows - that no route has the name.
 */
defineProps<{
  term: string
  near: readonly { slug: string, name: string }[]
  segmentsChecked: boolean
}>()

const emit = defineEmits<{ reset: [] }>()
</script>

<template>
  <div class="space-y-2 text-sm text-toned">
    <p class="font-medium text-highlighted">
      No route{{ segmentsChecked ? ' or segment' : '' }} named “{{ term.trim() }}”.
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
        >{{ route.name }}</NuxtLink>{{ index < near.length - 2 ? ', ' : index === near.length - 2 ? ' or ' : '?' }}
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
