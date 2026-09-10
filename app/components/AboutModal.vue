<script setup lang="ts">
import type { ModalProps } from '@nuxt/ui'

/**
 * `content` is UModal's own: the dialog content's props and `onXxx` events.
 * `app.vue` uses it to say where focus goes when the overlay closes after
 * the mobile menu opened it - see `useOverlays().onOverlayCloseAutoFocus`.
 */
defineProps<{ content?: ModalProps['content'] }>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal
    v-model:open="open"
    :content="content"
    title="About ZwiftBikes"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <AboutContent />
    </template>
  </UModal>
</template>
