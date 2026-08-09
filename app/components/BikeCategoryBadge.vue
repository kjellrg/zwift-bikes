<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'

defineProps<{
  category: BikeCategory
}>()
</script>

<template>
  <UBadge
    :color="BIKE_CATEGORY_COLORS[category]"
    variant="subtle"
  >
    {{ BIKE_CATEGORY_LABELS[category] }}
  </UBadge>
</template>
