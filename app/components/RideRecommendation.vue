<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'

/**
 * The Recommendation: rank 1 of the Ranking, shown large. The setup, its
 * estimated finish time, and the one-click paths deeper - the bike drawer
 * (ownership, upgrades, curves), the wheel alternatives for this frame, the
 * comparison, and the ranking it came first in. Everything equipment-specific
 * the old top card carried is still reachable from here; the badges and score
 * bar moved into the drawer and the comparison so the time is what the eye
 * lands on.
 *
 * It carries what a ranked row carries, because it IS one: the `01` marker in
 * the rows' own style, and the same Compare checkbox, so nothing about rank 1
 * has to be looked for further down the page.
 */
const props = defineProps<{
  combo: ComboScore
  /** Only read for the km/h next to the time and for the drawer's route context. */
  route?: RouteWithMeta
  /** Lap count the shown time was computed for. */
  laps?: number
  fastestTimeSec?: number
  loadWheelOptions?: (frameId: number) => Promise<ComboScore[]>
  /** The serialised query these results belong to, so the drawer's route curve can follow it - see `upgradeCurveKey`. */
  requestKey?: string
  /** The one-line "limited route data" warning, when the course inputs are partial - see `limitedCourseDataNote`. */
  limitedDataNote?: string
  /** Small evidence lines that qualify this time: the rough-surface cost, the paceline or bunch saving. */
  notes?: string[]
  /** Whether rank 1 is in the comparison - the page holds the picks, the same ones the rows toggle. */
  compared: boolean
  /** Whether the comparison is full and rank 1 is not in it - the checkbox is then disabled rather than evicting a pick. */
  compareDisabled: boolean
  /** How many setups are picked; 0 hides the jump to the comparison, which has nothing to show yet. */
  compareCount: number
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

const distanceKm = computed(() => props.route ? computeRouteTotals(props.route, props.laps ?? 1).distanceKm : undefined)
const botTested = computed(() => isBotTested(props.combo))
</script>

<template>
  <section
    aria-labelledby="ride-recommendation-heading"
    class="min-w-0 space-y-4"
  >
    <p class="text-xs font-semibold uppercase tracking-wide text-primary">
      <span class="tabular-nums">{{ rankMarker(1) }}</span> &middot; Fastest in current results
    </p>
    <div>
      <h2
        id="ride-recommendation-heading"
        class="text-3xl font-semibold text-highlighted break-words"
      >
        <button
          type="button"
          class="text-left hover:underline focus-visible:underline"
          :aria-label="`Details for ${combo.frame.name}`"
          @click="openDetail"
        >
          {{ combo.frame.name }}
        </button>
      </h2>
      <p class="mt-1 text-muted break-words">
        {{ combo.wheelset?.name ?? 'Fixed disc wheels (not swappable)' }}
      </p>
    </div>
    <div class="flex flex-wrap items-baseline gap-x-3">
      <p
        v-if="combo.finishTimeSec !== undefined"
        class="text-5xl font-bold tabular-nums text-highlighted"
      >
        {{ formatDuration(combo.finishTimeSec) }}
      </p>
      <p
        v-else
        class="text-5xl font-bold tabular-nums text-highlighted"
      >
        {{ combo.score }}
      </p>
      <p class="text-sm text-muted">
        {{ combo.finishTimeSec !== undefined ? 'estimated finish' : 'match score' }}<template v-if="combo.finishTimeSec !== undefined && distanceKm !== undefined">
          · {{ formatSpeedKmh(distanceKm, combo.finishTimeSec) }}
        </template>
      </p>
    </div>
    <slot name="fastest-overall" />
    <p
      v-if="limitedDataNote"
      class="flex items-start gap-2 text-sm text-warning"
    >
      <UIcon
        name="i-lucide-circle-alert"
        class="mt-0.5 size-4 shrink-0"
      />{{ limitedDataNote }}
    </p>
    <ul class="space-y-1 text-sm text-muted">
      <li class="flex items-center gap-2">
        <UIcon
          :name="botTested ? 'i-lucide-badge-check' : 'i-lucide-circle-help'"
          class="size-4 shrink-0"
          :class="botTested ? 'text-success' : ''"
        />{{ botTested ? 'Bot-tested equipment' : 'Includes estimated data' }}
        <!-- Only a measured frame has per-stage data, so only there does the
             stage mean anything - same gate as the card and the drawer. -->
        <span
          v-if="combo.frame.confidence === 'measured'"
          class="border-l border-default pl-2"
        >Stage {{ combo.frame.level }}{{ isOwned ? ', your bike' : ', assumed' }}</span>
      </li>
      <li
        v-for="note in notes"
        :key="note"
      >
        {{ note }}
      </li>
    </ul>
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
      <UButton
        icon="i-lucide-chart-no-axes-combined"
        size="sm"
        color="primary"
        variant="link"
        class="px-0"
        @click="openDetail"
      >
        Details &amp; upgrades
      </UButton>
      <UButton
        :icon="isOwned ? 'i-lucide-circle-check' : 'i-lucide-circle-plus'"
        size="sm"
        :color="isOwned ? 'success' : 'neutral'"
        variant="link"
        class="px-0"
        @click="toggleOwned"
      >
        {{ isOwned ? 'In your garage' : 'Add to garage' }}
      </UButton>
      <UCheckbox
        :model-value="compared"
        :disabled="compareDisabled"
        label="Compare"
        :aria-label="`Compare ${combo.frame.name}`"
        @update:model-value="emit('toggleCompare')"
      />
      <UButton
        v-if="compareCount"
        icon="i-lucide-columns-3"
        size="sm"
        color="primary"
        variant="link"
        class="px-0"
        @click="showComparison()"
      >
        Show comparison &middot; {{ compareCount }} of {{ COMPARISON_LIMIT }}
      </UButton>
      <!-- The ranking is one list and this is its rank 1, so the way to the
           rest of it belongs here rather than only at the top of that list. -->
      <a
        href="#ride-ranking"
        class="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <UIcon
          name="i-lucide-list-ordered"
          class="size-4"
        />See the full ranking
      </a>
    </div>
    <ComboWheelAlternatives
      :combo="combo"
      :load-wheel-options="loadWheelOptions"
    />
  </section>
</template>
