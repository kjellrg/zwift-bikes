<script setup lang="ts">
/**
 * What an events page shows in place of its content when the section is
 * hidden via the runtime site flags (`sections.events.mode: "hidden"`).
 * The optional notice is the flag's own wording - e.g. "Back next season."
 * The matching data endpoints answer 503 while this shows, so the section
 * is genuinely off, not just unlinked (`server/middleware/site-flags-gate.ts`).
 */
defineProps<{ notice?: string }>()
</script>

<template>
  <UContainer class="py-12 space-y-6">
    <h1 class="text-3xl font-bold font-display text-highlighted">
      The events calendar is taking a break
    </h1>
    <SiteNotice>
      <p>{{ notice ?? 'This section is temporarily unavailable. Everything else on the site works as usual - check back soon.' }}</p>
    </SiteNotice>
    <UButton to="/">
      Browse routes instead
    </UButton>
  </UContainer>
</template>
