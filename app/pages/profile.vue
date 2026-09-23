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
  <UContainer class="max-w-3xl py-10 space-y-8">
    <!-- The one width every secondary page and Overlay shares (`max-w-3xl`,
         see the modals): the page and the Overlay show the same content, and
         a different width here would read as a different site. -->
    <div>
      <h1 class="text-3xl font-bold font-display text-highlighted">
        My Profile
      </h1>
      <p class="mt-2 text-toned">
        Your weight, height and power set every finish time on the site; the
        defaults below apply wherever a link hasn't chosen otherwise.
      </p>
    </div>

    <ProfileContent />
  </UContainer>
</template>
