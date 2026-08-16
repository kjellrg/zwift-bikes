<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal
    v-model:open="open"
    title="My Garage"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <GarageContent />
    </template>
  </UModal>
</template>
