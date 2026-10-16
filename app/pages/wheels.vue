<script setup lang="ts">
// The wheel Standings (see `CONTEXT.md`) - the page is `StandingsPage`; this
// file is only its head.
const title = 'The fastest Zwift wheels across every route | ZwiftBikes'
const description = 'Every bot-tested Zwift wheelset, on each route\'s fastest bike, ranked by how far behind the fastest wheels it finishes on average - over every route, or only the worlds, terrain and distances you ride.'
useSeoMeta({
  title,
  description,
  ogTitle: 'The fastest Zwift wheels, across every route',
  ogDescription: description
})
defineOgImage('SiteCard', {}, { alt: 'ZwiftBikes – the fastest Zwift wheels across every route' })
</script>

<template>
  <StandingsPage kind="wheels" />
</template>
