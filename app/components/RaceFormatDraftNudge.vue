<script setup lang="ts">
import type { DraftNudge } from '../../shared/utils/raceRules'

/**
 * The nudge towards the draft mode a Race format is raced in, when the
 * ranking on screen was computed under another (see `raceFormatRules`): a
 * notice above the answer with the switch and a dismiss, on any page told a
 * format - a race page by its race, a segment page by `?rules=`.
 *
 * The switch is the only thing that changes the stored draft mode, never the
 * nudge appearing. Dismissing it is the page's to remember, for the visit.
 */
defineProps<{
  nudge: DraftNudge
}>()

const emit = defineEmits<{ dismiss: [] }>()

const { setDraftMode } = useRiderProfile()
</script>

<template>
  <SiteNotice class="mt-6">
    <p>{{ nudge.text }}</p>
    <template #actions>
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        @click="setDraftMode(nudge.mode)"
      >
        {{ nudge.action }}
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        aria-label="Dismiss draft mode hint"
        @click="emit('dismiss')"
      />
    </template>
  </SiteNotice>
</template>
