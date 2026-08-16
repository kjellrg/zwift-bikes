<script setup lang="ts">
/**
 * The not-affiliated line every page under `/events` ends with - one shared
 * component so the wording can't drift between the hub, season and race
 * pages. Static text with no date logic, so it server-renders and is part of
 * the prerendered HTML.
 *
 * We complement the organisers, we don't replace them - so when the season
 * knows its organizer the disclaimer names them, and when it has their URL
 * "the official event listing" links straight back to them.
 */
const props = defineProps<{
  organizer?: string
  organizerUrl?: string
}>()

// Zwift running its own series (ZRacing) would otherwise render as "not
// affiliated with Zwift or Zwift".
const organizerLabel = computed(() => {
  if (!props.organizer) return ' or the event organizers'
  return props.organizer.toLowerCase() === 'zwift' ? '' : ` or ${props.organizer}`
})
</script>

<template>
  <p class="text-xs text-muted border-t border-default pt-4">
    ZwiftBikes is not affiliated with Zwift{{ organizerLabel }}. Schedules are curated from public
    announcements and may lag corrections - always check
    <ULink
      v-if="organizerUrl"
      :to="organizerUrl"
      target="_blank"
      rel="noopener"
      class="text-primary underline"
    >the official event listing</ULink>
    <template v-else>
      the official event listing
    </template>
    before race day. The bike and wheel recommendations are ours alone.
  </p>
</template>
