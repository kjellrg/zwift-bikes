<script setup lang="ts">
/**
 * The site-wide MOTD banner, driven by the runtime site flags
 * (`useSiteFlags` - the host layout calls `load()`, this only renders).
 * Renders nothing until the flags have arrived post-mount, so prerendered
 * HTML and the first client render agree; a live message then pops in.
 */
const { activeMotd, dismissMotd } = useSiteFlags()
</script>

<template>
  <UContainer
    v-if="activeMotd"
    class="pt-4"
  >
    <SiteNotice :tone="activeMotd.tone">
      <p>{{ activeMotd.message }}</p>
      <template
        v-if="activeMotd.href || activeMotd.dismissible"
        #actions
      >
        <UButton
          v-if="activeMotd.href"
          :to="activeMotd.href"
          color="neutral"
          variant="outline"
          size="xs"
        >
          {{ activeMotd.linkText ?? 'Read more' }}
        </UButton>
        <UButton
          v-if="activeMotd.dismissible"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-x"
          aria-label="Close"
          @click="dismissMotd"
        />
      </template>
    </SiteNotice>
  </UContainer>
</template>
