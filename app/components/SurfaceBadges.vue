<script setup lang="ts">
import type { SurfaceEstimate } from "../../shared/types/catalog";

const props = defineProps<{
  surface: SurfaceEstimate;
}>();

// Only `'curated'` routes ever have non-zero gravel/cobble - `'unverified'`
// and `'heuristic'` routes always default to 100% road (see
// `estimateSurface` in `routeTerrain.ts`), so there's nothing non-tarmac to
// show for them.
const hasNonTarmac = computed(
  () => props.surface.gravel > 0 || props.surface.cobble > 0,
);
</script>

<template>
  <div v-if="hasNonTarmac" class="flex flex-wrap items-center gap-1.5">
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
    <UTooltip
      text="Best-effort estimate based on public route descriptions. Which Zwift worlds contain gravel/cobble sections at all is cross-checked against zwiftmap's community-mapped surface data (MIT licensed - see THIRD_PARTY_NOTICES.md)."
    >
      <UIcon name="i-lucide-info" class="size-4 text-muted" />
    </UTooltip>
  </div>
</template>
