<script setup lang="ts">
// The crawlable, deep-linkable copy of the report modal - same relationship
// `pages/about.vue` has to `AboutModal.vue`. This is the URL every "Report an
// issue" link keeps as its real `href`, so cmd-click and no-JS still land
// somewhere useful, and it's what README/SECURITY.md point riders at.
const title = 'Report an issue - ZwiftBikes'
const description
  = 'Report a bug on ZwiftBikes, or a frame, wheelset or route number that looks wrong. Reports go to GitHub issues, or by email if you\'d rather not use GitHub.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description
})
</script>

<template>
  <UContainer class="py-10 space-y-8">
    <div>
      <h1 class="text-3xl font-bold text-highlighted">
        Report an issue
      </h1>
      <p class="text-muted mt-1">
        Something broken, or a number that doesn't look right? Tell us about it.
      </p>
    </div>

    <div class="max-w-2xl">
      <ReportContent />
    </div>
  </UContainer>
</template>
