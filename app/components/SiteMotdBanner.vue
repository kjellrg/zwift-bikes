<script setup lang="ts">
/**
 * The site-wide MOTD banner, driven by the runtime site flags
 * (`useSiteFlags` - the host layout calls `load()`, this only renders).
 * Renders nothing until the flags have arrived post-mount, so prerendered
 * HTML and the first client render agree; a live message then pops in.
 */
const { activeMotd, dismissMotd } = useSiteFlags()

// A link whose target fails the check renders as its plain label: the schema
// already rejects such a message, this is the second lock.
const parts = computed(() => activeMotd.value ? parseMotdMessage(activeMotd.value.message) : [])
</script>

<template>
  <UContainer
    v-if="activeMotd"
    class="pt-4"
  >
    <SiteNotice :tone="activeMotd.tone">
      <p>
        <template
          v-for="(part, index) in parts"
          :key="index"
        >
          <NuxtLink
            v-if="'href' in part && isSafeMotdLink(part.href)"
            :to="part.href"
            class="font-medium text-highlighted underline underline-offset-2 hover:text-default"
          >{{ part.text }}</NuxtLink>
          <template v-else>
            {{ part.text }}
          </template>
        </template>
      </p>
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
