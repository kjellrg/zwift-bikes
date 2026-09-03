<script setup lang="ts">
// Mounted once in `app.vue` next to the modals and opened through
// `useOverlays().openBikeDetail` from any result card - the same
// global-state pattern `GarageModal` uses, see `useOverlays.ts`.
const open = defineModel<boolean>('open', { default: false })
const { bikeDetail } = useOverlays()
</script>

<template>
  <USlideover
    v-model:open="open"
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
