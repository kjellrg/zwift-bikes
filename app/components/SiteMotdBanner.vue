<script setup lang="ts">
/**
 * The site-wide MOTD banner, driven by the runtime site flags
 * (`useSiteFlags` - the host layout calls `load()`, this only renders).
 * Renders nothing until the flags have arrived post-mount, so prerendered
 * HTML and the first client render agree; a live message then pops in.
 */
const { activeMotd, dismissMotd } = useSiteFlags()

/** `tone` is deliberately a subset of UAlert's color names. */
const TONE_ICONS = {
  info: 'i-lucide-megaphone',
  warning: 'i-lucide-triangle-alert',
  error: 'i-lucide-octagon-alert'
} as const
</script>

<template>
  <UContainer
    v-if="activeMotd"
    class="pt-4"
  >
    <UAlert
      :color="activeMotd.tone"
      variant="subtle"
      :icon="TONE_ICONS[activeMotd.tone]"
      :description="activeMotd.message"
      :close="activeMotd.dismissible"
      @update:open="dismissMotd"
    />
  </UContainer>
</template>
