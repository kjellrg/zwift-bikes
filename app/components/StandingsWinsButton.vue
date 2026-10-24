<script setup lang="ts">
import type { StandingsRow } from '../utils/standings'

// A Standings row's "Fastest on" count: a button that opens the Fastest on
// Overlay, or plain text when the count is zero and there is nothing to list.
const props = defineProps<{ row: StandingsRow }>()
const emit = defineEmits<{ open: [] }>()
const label = computed(() => routesLabel(props.row.wonOn.length))
</script>

<template>
  <button
    v-if="row.wonOn.length"
    type="button"
    aria-haspopup="dialog"
    class="underline decoration-rule-strong hover:text-highlighted"
    :aria-label="`${label} ${row.entry.name} is fastest on`"
    @click="emit('open')"
  >
    {{ label }}
  </button>
  <template v-else>
    {{ label }}
  </template>
</template>
