<script setup lang="ts">
/**
 * The top of a ranking page: a breadcrumb line, then the H1 that carries the
 * question the page answers - "The fastest bike for" as a small lead line
 * and the Ride's name as the large one. One heading element, so a crawler
 * and a screen reader get the whole phrase ("The fastest bike for The Mega
 * Pretzel") while the eye gets the name.
 *
 * The crumbs are the page's own trail as text and links; classification
 * (a terrain category, a segment kind) may sit in it as plain text, never a
 * badge. Whatever a page must say before its Fact row - a race's Category
 * group selector - goes in the default slot.
 */
defineProps<{
  crumbs: { label: string, to?: string }[]
  /** The small line above the name. */
  lead?: string
  name: string
}>()
</script>

<template>
  <div class="pt-5 sm:pt-10">
    <nav aria-label="Breadcrumb">
      <ol class="flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-muted">
        <li
          v-for="crumb in crumbs"
          :key="crumb.label"
        >
          <NuxtLink
            v-if="crumb.to"
            :to="crumb.to"
            class="hover:text-highlighted"
          >
            {{ crumb.label }}
          </NuxtLink>
          <span v-else>{{ crumb.label }}</span>
        </li>
      </ol>
    </nav>
    <h1 class="mt-3 text-balance text-highlighted">
      <span class="block text-lg text-toned sm:text-xl">{{ lead ?? 'The fastest bike for' }}</span>{{ ' ' }}
      <span class="mt-1 block break-words text-[clamp(2.25rem,7vw,4.5rem)] font-bold leading-none font-display tracking-[-0.01em]">{{ name }}</span>
    </h1>
    <slot />
  </div>
</template>
