<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'
import type { AppliedRanking } from '../utils/recommendRequest'
import { comboPhysicsDelta, formatSignedDelta } from '../utils/rankingResults'

/**
 * One setup in the Ranking table, rank 1 included: a collapsed row of the
 * numbers that separate it from the others - time, gap, a gap bar, the
 * frame's aero and climb scores and its style - and, behind its disclosure,
 * the technical detail: its Wheel alternatives, its upgrade curve, its
 * physics against the stock bike, its stage, and the three actions a row
 * owns (the Equipment drawer, the Garage, the comparison pick). Everything a
 * row carries exists once, here, rank 1's row included - see **Ranking** in
 * `CONTEXT.md`.
 *
 * Its own `<tbody>`, so the row and its detail row stay one group for a
 * screen reader and one element to key the list by. The whole row opens on
 * a click anywhere that is not one of its own controls; the disclosure
 * button is the keyboard's way in, and what carries `aria-expanded`.
 */
const props = defineProps<{
  combo: ComboScore
  rank: number
  /** The Applied Ranking this row belongs to - its gaps, its drill-down, and what the drawer opens under. */
  ranking: AppliedRanking
  open: boolean
  compared: boolean
  /** Whether the comparison is full and this row is not in it - the pick is then disabled rather than evicting one. */
  compareDisabled: boolean
  /** The gap bar's length, 0..1 of the table's scale - see `RideRanking`. */
  bar: number
  /** Whether the table shows every column, which also keeps rows as rows on a phone (the container scrolls instead). */
  allColumns: boolean
}>()

const emit = defineEmits<{ toggle: [], toggleCompare: [] }>()

const { openBikeDetail } = useOverlays()

// Quick-adds start at the rider's default stage for unowned bikes - the
// stage unowned bikes are ranked at - so adding a bike never moves it. The
// garage's own add uses the same default (see `GarageContent`).
const { owned, setOwned } = useGarage()
const { defaultUnownedLevel } = useRiderProfile()
const isOwned = computed(() => owned.value[props.combo.frame.id] !== undefined)
function toggleOwned() {
  setOwned(props.combo.frame.id, isOwned.value ? null : defaultUnownedLevel.value)
}

// The tie check quantises the gap the way `formatDurationGap` does
// (hundredths), so a row that would print `+0.00s` reads "fastest" instead.
const gapSec = computed(() => props.combo.finishTimeSec !== undefined && props.ranking.fastestTimeSec !== undefined
  ? props.combo.finishTimeSec - props.ranking.fastestTimeSec
  : undefined)
const isFastest = computed(() => gapSec.value !== undefined && Math.round(gapSec.value * 100) <= 0)
const botTested = computed(() => isBotTested(props.combo))
const delta = computed(() => comboPhysicsDelta(props.combo))
const wheelType = computed(() => props.combo.wheelset ? WHEEL_CATEGORY_LABELS[props.combo.wheelset.rear.category] : 'Fixed')
const style = computed(() => props.combo.frame.style ? BIKE_STYLE_LABELS[props.combo.frame.style] : undefined)
const dataSource = computed(() => botTested.value ? 'Bot-tested' : 'Estimate')

const detailId = useId()
const columns = computed(() => props.allColumns ? 12 : 8)

/** A click on the row opens it, unless it landed on one of the row's own controls. */
function onRowClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('button, a, input, label, [role="checkbox"], [role="combobox"]')) return
  emit('toggle')
}
</script>

<template>
  <tbody
    role="rowgroup"
    class="border-b border-default"
    :class="!allColumns && 'max-md:block'"
  >
    <tr
      role="row"
      class="cursor-pointer align-top transition-colors hover:bg-elevated"
      :class="[
        open ? 'bg-elevated' : '',
        !allColumns && 'max-md:grid max-md:grid-cols-[2.25rem_minmax(0,1fr)_auto] max-md:gap-x-2 max-md:py-3'
      ]"
      @click="onRowClick"
    >
      <td
        role="cell"
        class="w-11 px-2.5 pt-4 text-right text-sm"
        :class="[rank === 1 ? 'font-semibold text-primary' : 'text-muted', !allColumns && 'max-md:row-span-3 max-md:p-0 max-md:pt-1']"
      >
        {{ rankMarker(rank) }}
      </td>
      <td
        role="cell"
        class="min-w-0 px-2.5 py-3"
        :class="!allColumns && 'max-md:p-0'"
      >
        <button
          type="button"
          class="text-left font-semibold text-highlighted break-words hover:underline"
          :aria-label="`Details for ${combo.frame.name}`"
          @click="openBikeDetail(combo)"
        >
          {{ combo.frame.name }}
        </button>
        <p class="text-sm text-muted break-words">
          {{ combo.wheelset?.name ?? 'Fixed disc wheels' }}<span
            v-if="!botTested"
            class="text-warning"
          > · estimate</span>
        </p>
      </td>
      <td
        role="cell"
        class="whitespace-nowrap px-2.5 py-3 text-right text-lg font-semibold font-heading text-highlighted"
        :class="!allColumns && 'max-md:p-0'"
      >
        {{ combo.finishTimeSec !== undefined ? formatDuration(combo.finishTimeSec) : `score ${combo.score}` }}
      </td>
      <td
        role="cell"
        class="whitespace-nowrap px-2.5 pt-4 text-right text-toned"
        :class="!allColumns && 'max-md:col-start-2 max-md:p-0 max-md:pt-1 max-md:text-left max-md:text-sm'"
      >
        {{ isFastest || gapSec === undefined ? 'fastest' : formatDurationGap(gapSec) }}
      </td>
      <td
        role="cell"
        class="w-[22%] min-w-28 px-2.5 pt-[1.3rem]"
        :class="!allColumns && 'max-md:col-span-2 max-md:col-start-2 max-md:row-start-3 max-md:w-auto max-md:min-w-0 max-md:p-0 max-md:pt-2'"
      >
        <!-- A meter, so the bar's length is something assistive tech can
             read too: the gap against the table's scale, which is the
             largest gap on the first page (see `RideRanking`). -->
        <div
          role="meter"
          aria-label="Gap to the fastest, against the table's scale"
          :aria-valuenow="Math.round(bar * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuetext="rank === 1 || isFastest ? 'fastest' : `${Math.round(bar * 100)}% of the largest gap on the first page`"
          class="h-1.5 overflow-hidden rounded-full bg-rule"
        >
          <div
            class="h-full rounded-full"
            :class="rank === 1 ? 'bg-primary' : 'bg-ink-toned'"
            :style="{ width: `${Math.max(2, bar * 100).toFixed(1)}%` }"
          />
        </div>
      </td>
      <td
        role="cell"
        class="whitespace-nowrap px-2.5 pt-4 text-sm text-muted"
        :class="!allColumns && 'max-md:hidden'"
      >
        <span class="text-toned">{{ combo.frame.scores.aero }}</span> / <span class="text-toned">{{ combo.frame.scores.climb }}</span>
      </td>
      <td
        role="cell"
        class="whitespace-nowrap px-2.5 pt-4 text-sm text-muted"
        :class="!allColumns && 'max-md:hidden'"
      >
        {{ style ?? '-' }}
      </td>
      <template v-if="allColumns">
        <td
          role="cell"
          class="whitespace-nowrap px-2.5 pt-4 text-right text-sm text-toned"
        >
          {{ delta ? `${formatSignedDelta(delta.cdaDeltaM2, 4)} m²` : '-' }}
        </td>
        <td
          role="cell"
          class="whitespace-nowrap px-2.5 pt-4 text-right text-sm text-toned"
        >
          {{ delta ? `${formatSignedDelta(delta.bikeMassDeltaKg, 2)} kg` : '-' }}
        </td>
        <td
          role="cell"
          class="whitespace-nowrap px-2.5 pt-4 text-sm text-toned"
        >
          {{ wheelType }}
        </td>
        <td
          role="cell"
          class="whitespace-nowrap px-2.5 pt-4 text-sm"
          :class="botTested ? 'text-success' : 'text-warning'"
        >
          {{ dataSource }}
        </td>
      </template>
      <td
        role="cell"
        class="w-10 px-1.5 pt-3"
        :class="!allColumns && 'max-md:col-start-3 max-md:row-start-2 max-md:p-0 max-md:text-right'"
      >
        <button
          type="button"
          class="inline-grid size-8 place-items-center rounded-md text-muted hover:text-highlighted"
          :aria-expanded="open"
          :aria-controls="detailId"
          :aria-label="`${open ? 'Hide' : 'Show'} details for ${combo.frame.name}${combo.wheelset ? ` with ${combo.wheelset.name}` : ''}`"
          @click="emit('toggle')"
        >
          <UIcon
            name="i-lucide-chevron-down"
            class="size-4 transition-transform"
            :class="open ? 'rotate-180' : ''"
          />
        </button>
      </td>
    </tr>
    <tr
      v-if="open"
      :id="detailId"
      role="row"
      class="bg-elevated"
      :class="!allColumns && 'max-md:block'"
    >
      <td
        role="cell"
        :colspan="columns"
        class="px-2.5 pt-1 pb-5 md:pl-14"
        :class="!allColumns && 'max-md:block max-md:pl-9'"
      >
        <div class="grid grid-cols-1 gap-x-10 gap-y-5 lg:grid-cols-[1.1fr_1fr_1fr]">
          <div class="min-w-0">
            <h3 class="mb-2 text-xs font-semibold text-muted">
              Other wheels on this frame
            </h3>
            <ComboWheelAlternatives
              v-if="combo.wheelset && (combo.wheelOptions ?? 1) > 1"
              :combo="combo"
              :load-wheel-options="ranking.loadWheelOptions"
            />
            <p
              v-else
              class="text-sm text-muted"
            >
              {{ combo.frame.hasFixedWheels ? 'Fixed disc wheels - no wheel swaps on this frame.' : 'No other wheels fit this frame under the current filters.' }}
            </p>
          </div>
          <div class="min-w-0">
            <h3 class="mb-2 text-xs font-semibold text-muted">
              Upgrade stages 0 to 5
            </h3>
            <UpgradeCurveChart
              v-if="combo.frame.upgradeCurve"
              :curve="combo.frame.upgradeCurve"
              :level="combo.frame.level"
            />
            <p
              v-else
              class="text-sm text-muted"
            >
              No per-stage bot tests for this frame, so its stage changes nothing here.
            </p>
            <p class="mt-2 text-sm">
              <RideStageControl :combo="combo" />
            </p>
          </div>
          <div class="min-w-0">
            <h3 class="mb-2 text-xs font-semibold text-muted">
              Versus the stock Zwift bike
            </h3>
            <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt class="text-toned">
                Drag area
              </dt>
              <dd class="text-right">
                {{ delta ? `${formatSignedDelta(delta.cdaDeltaM2, 4)} m²` : '-' }}
              </dd>
              <dt class="text-toned">
                Mass
              </dt>
              <dd class="text-right">
                {{ delta ? `${formatSignedDelta(delta.bikeMassDeltaKg, 2)} kg` : '-' }}
              </dd>
              <dt class="text-toned">
                Rolling resistance
              </dt>
              <dd class="text-right">
                {{ delta ? formatSignedDelta(delta.crrDelta, 4) : '-' }}
              </dd>
              <dt class="text-toned">
                Wheel type
              </dt>
              <dd class="text-right">
                {{ wheelType }}
              </dd>
              <dt class="text-toned">
                Frame scores
              </dt>
              <dd class="text-right">
                aero {{ combo.frame.scores.aero }} · climb {{ combo.frame.scores.climb }} · gravel {{ combo.frame.scores.gravel }}
              </dd>
              <dt class="text-toned">
                Data
              </dt>
              <dd
                class="text-right"
                :class="botTested ? 'text-success' : 'text-warning'"
              >
                {{ botTested ? 'Bot-tested' : 'Includes estimated data' }}
              </dd>
            </dl>
            <p
              v-if="!delta"
              class="mt-1 text-xs text-muted"
            >
              Only bot-tested equipment has solved physics.
            </p>
            <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <button
                type="button"
                class="text-primary hover:underline"
                :aria-label="`Details and upgrades for ${combo.frame.name}`"
                @click="openBikeDetail(combo)"
              >
                Details &amp; upgrades
              </button>
              <button
                type="button"
                class="hover:underline"
                :class="isOwned ? 'text-success' : 'text-primary'"
                :aria-label="`${isOwned ? 'Remove' : 'Quick-add'} ${combo.frame.name} ${isOwned ? 'from' : 'to'} garage`"
                @click="toggleOwned"
              >
                {{ isOwned ? 'In your garage' : 'Add to garage' }}
              </button>
              <UCheckbox
                :model-value="compared"
                :disabled="compareDisabled"
                label="Compare"
                :aria-label="`Compare ${combo.frame.name}`"
                @update:model-value="emit('toggleCompare')"
              />
            </div>
          </div>
        </div>
      </td>
    </tr>
  </tbody>
</template>
