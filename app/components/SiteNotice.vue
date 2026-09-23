<script setup lang="ts">
/**
 * Every notice on the site, in one style: a rule down the left, the title in
 * the ink, the words in the secondary ink. Informational by default, which
 * is what nearly every notice is - an explanation, a rule the ride follows,
 * a message of the day. `warning` and `error` keep their status colour on
 * the rule and the title only, and only for what really is one: a failed
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
  <div
    class="flex flex-wrap items-start gap-x-4 gap-y-2 border-l-2 bg-elevated/60 px-4 py-3 text-sm text-toned"
    :class="{
      'border-accented': tone === 'info',
      'border-warning': tone === 'warning',
      'border-error': tone === 'error'
    }"
  >
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
</template>
