<script setup lang="ts">
import type { ReportKind } from '../utils/report'

const open = defineModel<boolean>('open', { default: false })

// Seed passed through from whichever link opened the modal - see
// `useOverlays`. A footer click opens a blank bug report; a "something look
// wrong here?" link on a route page opens a data correction already naming
// the bike or route in question.
defineProps<{
  seedKind?: ReportKind
  seedItem?: string
}>()
</script>

<template>
  <UModal
    v-model:open="open"
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
