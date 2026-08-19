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
</script>

<template>
  <UContainer class="py-10 space-y-8">
    <div>
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
