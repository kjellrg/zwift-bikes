<script setup lang="ts">
defineProps<{
  /** Whether the row being stood in for has an upgrade-stage select - frames do, wheels don't. */
  stage?: boolean
}>()
</script>

<template>
  <!-- Same box as a garage row: the ownership switch, a name over its badges,
       and the stage select the bikes tab puts on the right. -->
  <div
    class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default p-3"
    aria-hidden="true"
  >
    <div class="flex items-center gap-3">
      <USkeleton class="h-5 w-9 rounded-full" />
      <div class="space-y-2">
        <USkeleton class="h-4 w-48" />
        <USkeleton class="h-4 w-24" />
      </div>
    </div>
    <USkeleton
      v-if="stage"
      class="h-8 w-32"
    />
  </div>
</template>
