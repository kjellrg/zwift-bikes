<script setup lang="ts">
/**
 * Every notice on the site, in one style: a small dot in the tone's colour,
 * the title in the ink, the words in the secondary ink. Informational by default, which
 * is what nearly every notice is - an explanation, a rule the ride follows,
 * a message of the day. `warning` and `error` keep their status colour on
 * the dot and the title only, and only for what really is one: a failed
 * refresh is an error, a section that is switched off is information. The
 * body never takes a status colour, so a paragraph stays readable in both
 * Colour modes.
 */
withDefaults(defineProps<{
  tone?: 'info' | 'warning' | 'error'
  title?: string
}>(), { tone: 'info' })
</script>

<template>
  <div class="flex items-start gap-3 rounded-lg bg-elevated/60 px-4 py-3 text-sm text-toned">
    <span
      class="mt-1.5 size-2 shrink-0 rounded-full"
      :class="{
        'bg-ink-toned': tone === 'info',
        'bg-warning': tone === 'warning',
        'bg-error': tone === 'error'
      }"
      aria-hidden="true"
    />
    <div class="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-2">
      <div class="min-w-0 flex-1 basis-64 space-y-1">
        <p
          v-if="title"
          class="font-semibold"
          :class="{
            'text-highlighted': tone === 'info',
            'text-warning': tone === 'warning',
            'text-error': tone === 'error'
          }"
        >
          {{ title }}
        </p>
        <slot />
      </div>
      <div
        v-if="$slots.actions"
        class="flex shrink-0 flex-wrap items-center gap-2"
      >
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
