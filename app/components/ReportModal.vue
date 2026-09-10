<script setup lang="ts">
import type { ModalProps } from '@nuxt/ui'
import type { ReportKind } from '../utils/report'

const open = defineModel<boolean>('open', { default: false })

// Seed passed through from whichever link opened the modal - see
// `useOverlays`. A footer click opens a blank bug report; a "something look
// wrong here?" link on a route page opens a data correction already naming
// the bike or route in question.
//
// `content` is UModal's own: the dialog content's props and `onXxx` events.
// `app.vue` uses it to say where focus goes when the overlay closes after
// the mobile menu opened it - see `overlayContent` there.
defineProps<{
  seedKind?: ReportKind
  seedItem?: string
  content?: ModalProps['content']
}>()
</script>

<template>
  <UModal
    v-model:open="open"
    :content="content"
    title="Report an issue"
    description="Write up a bug or a wrong number, then send it to GitHub or by email."
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <ReportContent
        :seed-kind="seedKind"
        :seed-item="seedItem"
      />
    </template>
  </UModal>
</template>
