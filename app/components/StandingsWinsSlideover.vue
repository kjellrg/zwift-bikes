<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'

// Mounted once in `app.vue` beside the Equipment drawer and opened through
// `useOverlays().openStandingsWins` from a Standings row's "Fastest on"
// count. `content` is USlideover's own, where `app.vue` puts the swipe that
// dismisses the Overlay back out of the edge it came from.
defineProps<{ content?: SlideoverProps['content'] }>()
const open = defineModel<boolean>('open', { default: false })
const { standingsWins } = useOverlays()
useCloseOverlaysOnNavigate(open)
</script>

<template>
  <USlideover
    v-model:open="open"
    :content="content"
    side="right"
    :title="standingsWins ? `Routes ${standingsWins.name} is fastest on` : 'Fastest on'"
    :description="standingsWins ? `${routesLabel(standingsWins.routes.length)}, with your filters applied` : undefined"
    :ui="{ content: 'sm:max-w-md', title: 'text-xl font-semibold font-heading', description: 'text-toned' }"
  >
    <template #body>
      <ul
        v-if="standingsWins"
        aria-label="Routes"
        class="divide-y divide-default border-y border-default"
      >
        <li
          v-for="winRoute in standingsWins.routes"
          :key="winRoute.slug"
        >
          <NuxtLink
            :to="routeLink(winRoute.slug, standingsWins.category)"
            class="flex flex-col px-1 py-2.5 hover:text-primary"
          >
            <span class="font-medium text-highlighted break-words">{{ winRoute.name }}</span>
            <span class="text-xs text-muted">{{ winRoute.worldName }} · {{ winRoute.terrainLabel }}</span>
          </NuxtLink>
        </li>
      </ul>
    </template>
  </USlideover>
</template>
