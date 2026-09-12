<script setup lang="ts">
/**
 * A racing series on the events hub: its name, and the organiser behind it
 * as a badge linking to their own page. We complement the original sources
 * rather than replacing them, so the way back to the organiser - signup,
 * rules, results - travels with the heading wherever seasons are listed.
 *
 * Two call sites, which is why it is a component rather than markup on the
 * page: the current seasons, and the past ones inside their disclosure. A
 * series whose every season has finished is listed only in the second, and
 * its organiser link would otherwise have gone missing from the page along
 * with the heading.
 */
defineProps<{
  seriesName: string
  organizer: string
  organizerUrl?: string
}>()
</script>

<template>
  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <!-- Always an `h2`, in the disclosure as well as in the current list: a
         season card's title is the `h3` under it either way, and a series
         that reads as a subsection in one place and a section in the other
         is a heading order that only makes sense to whoever wrote it. -->
    <h2 class="text-2xl font-semibold text-highlighted">
      {{ seriesName }}
    </h2>
    <UBadge
      color="neutral"
      variant="subtle"
    >
      <ULink
        v-if="organizerUrl"
        :to="organizerUrl"
        target="_blank"
        rel="noopener"
        class="hover:text-primary"
      >{{ organizer }}</ULink>
      <template v-else>
        {{ organizer }}
      </template>
    </UBadge>
  </div>
</template>
