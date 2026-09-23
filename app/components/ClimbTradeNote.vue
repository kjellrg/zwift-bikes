<script setup lang="ts">
import type { ClimbTrade } from '../../shared/types/rideNotes'
import { climbTradeNote } from '../utils/climbTrade'

/**
 * The Climb trade (see `CONTEXT.md`): the note beside the Recommendation
 * that names one setup slower over the whole Ride but quicker over a named
 * climb's last pass, and hands the choice to the rider. Race drafting assumes
 * the rider stays in the bunch to the line, so the Ranking cannot weigh what
 * the climb where the field splits is worth - only the rider can.
 *
 * A sibling of `FastestOverallNote`, and like it rendered from the recommend
 * endpoint's own response (`climbTrade`), so the sentence is in the
 * server-rendered HTML. It reads the Applied Ranking through that response,
 * never the live controls, and has no action: the choice it offers is the
 * rider's to make in the game.
 */
const props = defineProps<{ trade: ClimbTrade }>()

const note = computed(() => climbTradeNote(props.trade))
</script>

<template>
  <p class="mt-5 border-l-2 border-accented py-2 pl-3.5 text-sm text-toned">
    <span class="font-semibold text-highlighted">{{ note.lead }}</span>
    {{ note.text }}
  </p>
</template>
