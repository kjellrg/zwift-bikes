<script setup lang="ts">
/**
 * A racing series on the events hub: its name, and the organiser behind it
 * as a quiet text link to their own page. We complement the original sources
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
         season card's title is the `h3` under it either way. -->
    <h2 class="text-2xl font-semibold font-heading text-highlighted">
      {{ seriesName }}
    </h2>
    <span class="text-sm text-muted">
      by
      <a
        v-if="organizerUrl"
        :href="organizerUrl"
        target="_blank"
        rel="noopener"
        class="underline decoration-rule-strong hover:text-highlighted"
      >{{ organizer }}</a>
      <template v-else>{{ organizer }}</template>
    </span>
  </div>
</template>
