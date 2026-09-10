<script setup lang="ts">
import type { ModalProps } from '@nuxt/ui'

/**
 * `content` is UModal's own: the dialog content's props and `onXxx` events.
 * `app.vue` uses it to say where focus goes when the overlay closes after
 * the mobile menu opened it - see `overlayContent` there.
 */
defineProps<{ content?: ModalProps['content'] }>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal
    v-model:open="open"
    :content="content"
    title="My Profile"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <ProfileContent />
    </template>
  </UModal>
</template>
