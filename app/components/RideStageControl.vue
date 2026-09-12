<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'

/**
 * The upgrade stage a setup is ranked at, on the recommendation and on
 * every ranked row. A bike in the garage gets a select, since the stage is
 * the rider's own fact to edit and the ranking follows it (`setOwned`
 * persists, the request re-serialises the garage, the page refetches). A
 * bike the rider does not own shows the stage it is assumed at - the
 * profile's default for unowned bikes - as text, because that number is
 * edited in one place, not on three hundred rows.
 *
 * Only a measured frame has per-stage data, so only there does the stage
 * mean anything: the same gate as the drawer's stage buttons, and nothing
 * renders for an estimated frame.
 */
const props = defineProps<{ combo: ComboScore }>()

const { owned, setOwned } = useGarage()
const isOwned = computed(() => owned.value[props.combo.frame.id] !== undefined)
</script>

<template>
  <span
    v-if="combo.frame.confidence === 'measured'"
    class="inline-flex items-center gap-1.5"
  >
    <USelectMenu
      v-if="isOwned"
      :model-value="owned[combo.frame.id]"
      value-key="value"
      :items="UPGRADE_STAGE_OPTIONS"
      :search-input="false"
      size="xs"
      variant="ghost"
      :aria-label="`Upgrade stage for ${combo.frame.name}`"
      @update:model-value="(level: number) => setOwned(combo.frame.id, level)"
    />
    <UTooltip
      v-else
      text="The stage bikes you don't own are ranked at - change the default in your profile, or add the bike to your garage to set its own"
    >
      <span class="text-muted">Stage {{ combo.frame.level }}, assumed</span>
    </UTooltip>
  </span>
</template>
