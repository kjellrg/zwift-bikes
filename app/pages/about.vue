<script setup lang="ts">
const title = 'About - ZwiftBikes'
const description
  = 'ZwiftBikes is an unofficial fan project that ranks every bike frame and wheelset by predicted finish time for a given Zwift route. Built on zwift-data, ZwiftInsider bot speed tests, zwiftmap and real GPS route traces.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description
})

// Issue #59: same generated brand card as the homepage - what's shared from
// here is the site, not a specific route or race.
defineOgImage('SiteCard', {}, {
  alt: 'ZwiftBikes - find the fastest bike and wheelset for any Zwift route'
})
</script>

<template>
  <UContainer class="py-10 space-y-8">
    <div class="max-w-2xl">
      <h1 class="text-3xl font-bold text-highlighted">
        About ZwiftBikes
      </h1>
      <p class="text-muted mt-1">
        What this project is, where its numbers come from, and what it does
        with your data.
      </p>
    </div>

    <div class="max-w-2xl">
      <AboutContent />
    </div>
  </UContainer>
</template>
