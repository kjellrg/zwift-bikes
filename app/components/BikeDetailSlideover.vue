<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'

// Mounted once in `app.vue` next to the modals and opened through
// `useOverlays().openBikeDetail` from any result card - the same
// global-state pattern `GarageModal` uses, see `useOverlays.ts`.
//
// `content` is USlideover's own: the dialog content's props and `onXxx`
// events, which is where `app.vue` puts the swipe that dismisses the drawer
// back out of the edge it came from (#239).
defineProps<{ content?: SlideoverProps['content'] }>()
const open = defineModel<boolean>('open', { default: false })
const { bikeDetail } = useOverlays()
</script>

<template>
  <USlideover
    v-model:open="open"
    :content="content"
    side="right"
    :title="bikeDetail?.combo.frame.name ?? 'Bike details'"
    :description="bikeDetail?.combo.wheelset?.name ?? (bikeDetail ? 'Fixed disc wheels (not swappable)' : undefined)"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <BikeDetailContent
        v-if="bikeDetail"
        :detail="bikeDetail"
      />
    </template>
  </USlideover>
</template>
