<script setup lang="ts">
import type { TerrainProfile } from '../../shared/types/catalog'

defineProps<{
  terrain: TerrainProfile
}>()
</script>

<template>
  <UBadge
    :color="TERRAIN_COLORS[terrain.category]"
    variant="subtle"
    icon="i-lucide-mountain"
  >
    {{ TERRAIN_LABELS[terrain.category] }}
  </UBadge>
</template>
