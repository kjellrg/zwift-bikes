<script setup lang="ts">
// The crawlable/deep-linkable copy of the profile: the same `ProfileContent`
// the header's modal shows, wrapped in a real route so /profile keeps working
// as a bookmark and cmd/ctrl-click from the nav still opens a page.

// Everything on this page renders from localStorage, so a crawler only ever
// sees an empty shell - thin content with nothing to rank for. Keep it out
// of the index, but still follow its links out. `useRobotsRule` (from
// @nuxtjs/robots) rather than `useSeoMeta`, so this owns the single robots
// meta tag the module manages instead of racing it, and sets the matching
// X-Robots-Tag header too. Stays here rather than in `ProfileContent`, which
// the modal mounts on top of other pages.
useRobotsRule('noindex, follow')
</script>

<template>
  <UContainer class="py-10 space-y-8 sm:max-w-2xl">
    <!-- Capped at the overlay's own width (`sm:max-w-2xl`, see
         `ProfileModal`): the page and the overlay show the same controls, and
         a form that stretched to a desktop container's full width here and
         sat in a narrow dialog there would read as two different pages. -->
    <div>
      <h1 class="text-3xl font-bold text-highlighted">
        My Profile
      </h1>
      <p class="text-muted mt-2">
        Your weight, height and power set every finish time on the site; the
        defaults below apply wherever a link hasn't chosen otherwise.
      </p>
    </div>

    <ProfileContent />
  </UContainer>
</template>
