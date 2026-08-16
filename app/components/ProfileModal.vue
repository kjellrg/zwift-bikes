<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal
    v-model:open="open"
    title="My Profile"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <ProfileContent />
    </template>
  </UModal>
</template>
