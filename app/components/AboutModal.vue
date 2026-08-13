<script setup lang="ts">
const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <UModal
    v-model:open="open"
    title="About Zwift Best Bike"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <AboutContent />
    </template>
  </UModal>
</template>
