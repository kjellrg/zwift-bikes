<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'

/**
 * One ranked setup in the Ranking, from rank 2 down (rank 1 is the
 * Recommendation, which carries the same parts): rank, names, the gap to the
 * fastest, where its numbers come from, and the same three paths the
 * recommendation offers - the drawer, the garage, the frame's other wheels -
 * plus the comparison checkbox. Its own component so each row owns its drawer
 * sync and its wheel-list state.
 */
const props = defineProps<{
  combo: ComboScore
  rank: number
  route?: RouteWithMeta
  laps?: number
  fastestTimeSec?: number
  loadWheelOptions?: (frameId: number) => Promise<ComboScore[]>
  /** The serialised query these results belong to, so the drawer's route curve can follow it - see `upgradeCurveKey`. */
  requestKey?: string
  compared: boolean
  /** Whether the comparison is full and this row is not in it - the checkbox is then disabled rather than evicting a pick. */
  compareDisabled: boolean
}>()

const emit = defineEmits<{ toggleCompare: [] }>()

const { openDetail } = useComboDetail({
  combo: () => props.combo,
  route: () => props.route,
  laps: () => props.laps,
  fastestTimeSec: () => props.fastestTimeSec,
  loadFrameCombos: () => props.loadWheelOptions,
  requestKey: () => props.requestKey
})

// Quick-adds start at the rider's chosen default stage for unowned bikes -
// the stage unowned bikes are scored and displayed at everywhere else - so
// adding a bike never moves it in the ranking. The garage modal's own add
// uses the same default; the two must agree, or the same action persists a
// different stage depending on where it was clicked (see `GarageContent`).
const { owned, setOwned } = useGarage()
const { defaultUnownedLevel } = useRiderProfile()
const isOwned = computed(() => owned.value[props.combo.frame.id] !== undefined)
function toggleOwned() {
  setOwned(props.combo.frame.id, isOwned.value ? null : defaultUnownedLevel.value)
}

// The tie check quantises the gap the way `formatDurationGap` does (hundredths), so a row
// that would render `+0.00s` shows its time instead.
const isFastest = computed(() => props.combo.finishTimeSec !== undefined
  && (props.fastestTimeSec === undefined || Math.round((props.combo.finishTimeSec - props.fastestTimeSec) * 100) <= 0))
const botTested = computed(() => isBotTested(props.combo))
</script>

<template>
  <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-3 border-t border-default py-5 sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
    <span class="pt-1 text-xs tabular-nums text-muted">{{ rankMarker(rank) }}</span>
    <div class="min-w-0">
      <h3 class="text-base font-semibold text-highlighted break-words">
        <button
          type="button"
          class="text-left hover:underline focus-visible:underline"
          :aria-label="`Details for ${combo.frame.name}`"
          @click="openDetail"
        >
          {{ combo.frame.name }}
        </button>
      </h3>
      <p class="mt-0.5 text-sm text-muted break-words">
        {{ combo.wheelset?.name ?? 'Fixed disc wheels (not swappable)' }}
      </p>
    </div>
    <div class="col-start-2 flex items-baseline gap-2 sm:col-start-3 sm:flex-col sm:items-end sm:gap-0 sm:text-right">
      <p
        v-if="combo.finishTimeSec !== undefined"
        class="text-xl font-bold tabular-nums whitespace-nowrap"
        :class="isFastest ? 'text-primary' : 'text-warning'"
      >
        {{ isFastest ? formatDuration(combo.finishTimeSec) : formatDurationGap(combo.finishTimeSec - fastestTimeSec!) }}
      </p>
      <p
        v-else
        class="text-xl font-bold tabular-nums text-primary"
      >
        {{ combo.score }}
      </p>
      <p class="text-xs text-muted">
        {{ combo.finishTimeSec === undefined ? 'match score' : isFastest ? 'estimated finish' : 'behind fastest' }}
      </p>
    </div>
    <div class="col-start-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:col-span-2">
      <span class="inline-flex items-center gap-1.5 text-muted">
        <UIcon
          :name="botTested ? 'i-lucide-badge-check' : 'i-lucide-circle-help'"
          class="size-4 shrink-0"
          :class="botTested ? 'text-success' : ''"
        />{{ botTested ? 'Bot-tested' : 'Includes estimates' }}
      </span>
      <RideStageControl :combo="combo" />
      <UButton
        icon="i-lucide-chart-no-axes-combined"
        size="xs"
        color="primary"
        variant="link"
        class="px-0"
        :aria-label="`Details and upgrades for ${combo.frame.name}`"
        @click="openDetail"
      >
        Details &amp; upgrades
      </UButton>
      <UButton
        :icon="isOwned ? 'i-lucide-circle-check' : 'i-lucide-circle-plus'"
        size="xs"
        :color="isOwned ? 'success' : 'neutral'"
        variant="link"
        class="px-0"
        :aria-label="`${isOwned ? 'Remove' : 'Quick-add'} ${combo.frame.name} ${isOwned ? 'from' : 'to'} garage`"
        @click="toggleOwned"
      >
        {{ isOwned ? 'In your garage' : 'Add to garage' }}
      </UButton>
      <UCheckbox
        :model-value="compared"
        :disabled="compareDisabled"
        label="Compare"
        :aria-label="`Compare ${combo.frame.name}`"
        class="sm:ml-auto"
        @update:model-value="emit('toggleCompare')"
      />
    </div>
    <div class="col-start-2 sm:col-span-2">
      <ComboWheelAlternatives
        :combo="combo"
        :load-wheel-options="loadWheelOptions"
      />
    </div>
  </li>
</template>
