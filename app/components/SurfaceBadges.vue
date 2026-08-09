<script setup lang="ts">
import type { SurfaceEstimate } from '../../shared/types/catalog'

defineProps<{
  surface: SurfaceEstimate
}>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <UBadge
      v-if="surface.gravel > 0"
      color="warning"
      variant="subtle"
      icon="i-lucide-mountain-snow"
    >
      ~{{ surface.gravel }}% gravel
    </UBadge>
    <UBadge
      v-if="surface.cobble > 0"
      color="neutral"
      variant="subtle"
      icon="i-lucide-grip"
    >
      ~{{ surface.cobble }}% cobbles
    </UBadge>
    <UBadge
      v-if="surface.gravel === 0 && surface.cobble === 0"
      color="success"
      variant="subtle"
      icon="i-lucide-road"
    >
      Paved road
    </UBadge>
    <UTooltip
      :text="
        surface.confidence === 'curated'
          ? 'Best-effort estimate based on known route descriptions'
          : 'Assumed fully paved - not individually verified'
      "
    >
      <UIcon
        name="i-lucide-info"
        class="size-4 text-muted"
      />
    </UTooltip>
  </div>
</template>
