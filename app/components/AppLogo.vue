<script setup lang="ts">
/**
 * The wordmark: a small profile-shaped mark in the primary beside the name
 * in the display width. The same mark is the favicon, the touch icon and
 * the static share image (`public/`), and the share cards draw it too, so
 * the brand has one form. Decorative here - the link around it carries the
 * name.
 */
</script>

<template>
  <span class="inline-flex items-center gap-2.5 text-xl font-bold font-display text-highlighted">
    <svg
      viewBox="0 0 30 20"
      class="h-5 w-[30px] shrink-0 fill-primary"
      aria-hidden="true"
    >
      <path d="M1 17 L7 9 L11 13 L17 3 L22 11 L25 8 L29 17 Z" />
    </svg>
    <span>ZwiftBikes</span>
  </span>
</template>
