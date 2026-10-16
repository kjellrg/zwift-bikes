<script setup lang="ts">
// The bike Standings (see `CONTEXT.md`) - the page is `StandingsPage`; this
// file is only its head.
const title = 'The fastest Zwift bike across every route | ZwiftBikes'
const description = 'Every bot-tested Zwift frame, on its own fastest wheels, ranked by how far behind the fastest bike it finishes on average - over every route, or only the worlds, terrain and distances you ride.'
useSeoMeta({
  title,
  description,
  ogTitle: 'The fastest Zwift bikes, across every route',
  ogDescription: description
})
defineOgImage('SiteCard', {}, { alt: 'ZwiftBikes – the fastest Zwift bikes across every route' })
</script>

<template>
  <StandingsPage kind="bikes" />
</template>
