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
  <UContainer class="py-10">
    <UButton
      to="/"
      variant="link"
      color="neutral"
      icon="i-lucide-arrow-left"
      class="mb-4 px-0"
    >
      Back to all routes
    </UButton>
    <UCard>
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <UIcon
          name="i-lucide-calendar-off"
          class="size-8 text-muted"
        />
        <p class="text-lg font-semibold text-highlighted">
          The events calendar is taking a break
        </p>
        <p class="text-muted max-w-md">
          {{ notice ?? 'This section is temporarily unavailable. Everything else on the site works as usual - check back soon.' }}
        </p>
        <UButton
          to="/"
          color="primary"
          variant="subtle"
          class="mt-2"
        >
          Browse routes instead
        </UButton>
      </div>
    </UCard>
  </UContainer>
</template>
