<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'

// Mounted once in `app.vue` next to the modals and opened through
// `useOverlays().openBikeDetail` from any ranked row - the same
// global-state pattern `GarageModal` uses, see `useOverlays.ts`.
//
// `content` is USlideover's own: the dialog content's props and `onXxx`
// events, which is where `app.vue` puts the swipe that dismisses the drawer
// back out of the edge it came from (#239).
defineProps<{ content?: SlideoverProps['content'] }>()
const open = defineModel<boolean>('open', { default: false })
const { bikeDetail } = useOverlays()
const appliedRanking = useAppliedRankingSlot()

/**
 * What the drawer is showing: its own record read against the Applied
 * Ranking on screen - see `equipmentDrawerView`. Derived here rather than in
 * the body, because this component is mounted for the life of the app while
 * the body exists only while the drawer is open, and the record has to stay
 * current either way.
 */
const view = computed(() => bikeDetail.value && equipmentDrawerView(bikeDetail.value, appliedRanking.value))

/**
 * The record the view settled on is the one the drawer now remembers, so a
 * bike that later drops off the rows keeps the last numbers it was ranked
 * with rather than the ones it was opened with. The guard is what stops this
 * writing on every render: the derivation hands back the very record it was
 * given unless the live Ranking had something newer.
 */
watch(view, (current) => {
  if (current && current.record !== bikeDetail.value) bikeDetail.value = current.record
}, { immediate: true })
</script>

<template>
  <USlideover
    v-model:open="open"
    :content="content"
    side="right"
    :title="view?.record.combo.frame.name ?? 'Bike details'"
    :description="view?.record.combo.wheelset?.name ?? (view ? 'Fixed disc wheels (not swappable)' : undefined)"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <BikeDetailContent
        v-if="view"
        :view="view"
      />
    </template>
  </USlideover>
</template>
