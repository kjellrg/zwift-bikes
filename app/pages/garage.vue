<script setup lang="ts">
// The crawlable/deep-linkable copy of the garage: the same `GarageContent`
// the header's modal shows, wrapped in a real route so /garage keeps working
// as a bookmark and cmd/ctrl-click from the nav still opens a page.

// Everything on this page renders from localStorage, so a crawler only ever
// sees an empty shell - thin content with nothing to rank for. Keep it out
// of the index, but still follow its links out. `useRobotsRule` (from
// @nuxtjs/robots) rather than `useSeoMeta`, so this owns the single robots
// meta tag the module manages instead of racing it, and sets the matching
// X-Robots-Tag header too. Stays here rather than in `GarageContent`, which
// the modal mounts on top of other pages.
useRobotsRule('noindex, follow')
</script>

<template>
  <UContainer class="py-10 space-y-8">
    <div>
      <h1 class="text-3xl font-bold text-highlighted">
        My Garage
      </h1>
    </div>

    <GarageContent />
  </UContainer>
</template>
