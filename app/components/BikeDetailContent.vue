<script setup lang="ts">
import type { ClassifiedWheel, EquipmentPhysicsDelta } from '../../shared/types/catalog'
import type { BikeDetail } from '../composables/useOverlays'

/**
 * Everything the app knows about one frame+wheelset combo, laid out as a
 * drawer. Deliberately presentation-only: every number comes from the
 * `ComboScore` the result card already holds (scores, confidence, solved
 * physics deltas, breakdown, finish time), so opening it costs no request
 * and can never disagree with the card it was opened from.
 */
const props = defineProps<{ detail: BikeDetail }>()

const combo = computed(() => props.detail.combo)
const frame = computed(() => combo.value.frame)
const wheelset = computed(() => combo.value.wheelset)

const { owned, load, setOwned, setWheelOwned, isWheelOwned } = useGarage()
const { defaultUnownedLevel } = useRiderProfile()
onMounted(() => load())

const isOwnedFrame = computed(() => owned.value[frame.value.id] !== undefined)
const ownedFrameLevel = computed(() => owned.value[frame.value.id])
const isOwnedWheel = computed(() => !!wheelset.value && isWheelOwned(wheelset.value.key))

// Same default as the card's quick-add and the garage modal - see the
// comment on `defaultUnownedLevel` in `ComboResultCard.vue`.
function toggleFrameOwned() {
  setOwned(frame.value.id, isOwnedFrame.value ? null : defaultUnownedLevel.value)
}
function toggleWheelOwned() {
  if (wheelset.value) setWheelOwned(wheelset.value.key, !isOwnedWheel.value)
}

const finishTimeSec = computed(() => combo.value.finishTimeSec)
const gapSec = computed(() => finishTimeSec.value !== undefined && props.detail.fastestTimeSec !== undefined
  ? Math.max(0, finishTimeSec.value - props.detail.fastestTimeSec)
  : undefined)
const totalDistanceKm = computed(() => props.detail.route ? computeRouteTotals(props.detail.route, props.detail.laps ?? 1).distanceKm : undefined)
const surfacePenaltyText = computed(() => props.detail.route ? formatSurfaceTimePenalty(props.detail.route.surface, combo.value.surfaceTimePenaltySec) : undefined)

/** One row per rating, one column per part - the frame's, each wheel's, and the set's blended value. */
const scoreRows = computed(() => {
  const cols: { key: string, label: string, scores: { aero: number, climb: number, gravel: number, cobble: number } }[] = [
    { key: 'frame', label: 'Frame', scores: frame.value.scores }
  ]
  if (wheelset.value) {
    cols.push({ key: 'front', label: 'Front wheel', scores: wheelset.value.front.scores })
    if (wheelset.value.rear.id !== wheelset.value.front.id) cols.push({ key: 'rear', label: 'Rear wheel', scores: wheelset.value.rear.scores })
  }
  return { cols, rows: [
    { key: 'aero', label: 'Aero (flat/fast)' },
    { key: 'climb', label: 'Climbing' },
    { key: 'gravel', label: 'Gravel' },
    { key: 'cobble', label: 'Cobbles' }
  ] as const }
})

/**
 * The solved deltas, relative to the category's reference bike (Zwift
 * Carbon + 32mm Carbon for road frames and every wheel; Zwift TT for TT
 * frames - see `physics/equipment.ts`). Only measured gear has them.
 */
const physicsRows = computed(() => {
  const rows: { label: string, physics: EquipmentPhysicsDelta | undefined, confidence: 'measured' | 'estimated', crrClass?: ClassifiedWheel['crrClass'] }[] = [
    { label: 'Frame', physics: frame.value.physics, confidence: frame.value.confidence }
  ]
  if (wheelset.value) rows.push({ label: 'Wheels', physics: wheelset.value.physics, confidence: wheelset.value.confidence, crrClass: wheelset.value.crrClass })
  return rows
})

const signed = (value: number, digits: number) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
const baselineName = computed(() => frame.value.category === 'tt' ? 'the Zwift TT reference bike' : 'the Zwift Carbon reference bike')
const CRR_CLASS_LABELS: Record<ClassifiedWheel['crrClass'], string> = { road: 'Road', gravel: 'Gravel', mountain: 'Mountain' }
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-3">
      <div class="flex flex-wrap items-center gap-1.5">
        <BikeCategoryBadge :category="frame.category" />
        <UBadge
          v-if="frame.style"
          color="neutral"
          variant="subtle"
        >
          {{ frame.style }} style
        </UBadge>
        <UBadge
          color="neutral"
          variant="subtle"
        >
          {{ wheelset ? WHEEL_CATEGORY_LABELS[wheelset.rear.category] : 'Fixed disc' }} wheels
        </UBadge>
        <UBadge
          v-if="wheelset"
          color="neutral"
          variant="subtle"
        >
          {{ CRR_CLASS_LABELS[wheelset.crrClass] }} rolling class
        </UBadge>
        <UBadge
          :color="frame.confidence === 'measured' ? 'success' : 'neutral'"
          variant="subtle"
          :icon="frame.confidence === 'measured' ? 'i-lucide-badge-check' : 'i-lucide-help-circle'"
        >
          frame {{ frame.confidence === 'measured' ? 'verified' : 'estimated' }}
        </UBadge>
        <UBadge
          v-if="wheelset"
          :color="wheelset.confidence === 'measured' ? 'success' : 'neutral'"
          variant="subtle"
          :icon="wheelset.confidence === 'measured' ? 'i-lucide-badge-check' : 'i-lucide-help-circle'"
        >
          wheels {{ wheelset.confidence === 'measured' ? 'verified' : 'estimated' }}
        </UBadge>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <UButton
          size="sm"
          :color="isOwnedFrame ? 'success' : 'neutral'"
          variant="subtle"
          :icon="isOwnedFrame ? 'i-lucide-circle-check' : 'i-lucide-circle-plus'"
          @click="toggleFrameOwned"
        >
          {{ isOwnedFrame ? 'Frame in your garage' : 'Add frame to garage' }}
        </UButton>
        <UButton
          v-if="wheelset"
          size="sm"
          :color="isOwnedWheel ? 'success' : 'neutral'"
          variant="subtle"
          :icon="isOwnedWheel ? 'i-lucide-circle-check' : 'i-lucide-circle-plus'"
          @click="toggleWheelOwned"
        >
          {{ isOwnedWheel ? 'Wheels in your garage' : 'Add wheels to garage' }}
        </UButton>
      </div>
      <div
        v-if="isOwnedFrame && frame.confidence === 'measured'"
        class="flex flex-wrap items-center gap-2 text-sm"
      >
        <span class="text-muted">Your upgrade level</span>
        <div class="flex items-center gap-0.5">
          <button
            v-for="level in [0, 1, 2, 3, 4, 5]"
            :key="level"
            type="button"
            class="flex size-6 items-center justify-center rounded text-xs font-medium transition-colors"
            :class="level === ownedFrameLevel ? 'bg-primary text-inverted' : 'bg-elevated text-muted hover:bg-accented'"
            :aria-label="`Set upgrade level ${level} for ${frame.name}`"
            :aria-pressed="level === ownedFrameLevel"
            @click="setOwned(frame.id, level)"
          >
            {{ level }}
          </button>
        </div>
      </div>
      <p
        v-else
        class="text-xs text-muted"
      >
        Scored at upgrade level {{ frame.level }}<template v-if="!isOwnedFrame && frame.confidence === 'measured'">
          (your default for bikes you don't own - change it in your profile)
        </template>.
      </p>
    </section>

    <section
      v-if="finishTimeSec !== undefined"
      class="space-y-2"
    >
      <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">
        On this route
      </h3>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="text-muted">
          Est. finish time
        </dt>
        <dd class="font-semibold text-highlighted tabular-nums">
          {{ formatDuration(finishTimeSec) }}<template v-if="totalDistanceKm !== undefined">
            <span class="font-normal text-muted"> · {{ formatSpeedKmh(totalDistanceKm, finishTimeSec) }}</span>
          </template>
        </dd>
        <template v-if="gapSec !== undefined">
          <dt class="text-muted">
            Behind the fastest
          </dt>
          <dd
            class="font-semibold tabular-nums"
            :class="gapSec > 0 ? 'text-warning' : 'text-success'"
          >
            {{ gapSec > 0 ? formatDurationDelta(gapSec) : 'This is the fastest combo' }}
          </dd>
        </template>
        <template v-if="surfacePenaltyText">
          <dt class="text-muted">
            Off-tarmac cost
          </dt>
          <dd class="text-highlighted">
            {{ surfacePenaltyText }}
          </dd>
        </template>
        <dt class="text-muted">
          Match score
        </dt>
        <dd class="text-highlighted">
          {{ combo.score }} / 100
          <span class="text-muted">- terrain fit; the ranking itself is by time</span>
        </dd>
      </dl>
    </section>

    <section class="space-y-3">
      <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">
        Why it ranks here
      </h3>
      <ScoreBreakdown :breakdown="combo.breakdown" />
      <div class="overflow-x-auto rounded-lg border border-default">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50">
            <tr class="text-left text-muted">
              <th class="px-3 py-2 font-medium">
                Rating (0-100)
              </th>
              <th
                v-for="col in scoreRows.cols"
                :key="col.key"
                class="px-3 py-2 font-medium text-right"
              >
                {{ col.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in scoreRows.rows"
              :key="row.key"
              class="border-t border-default"
            >
              <td class="px-3 py-2">
                {{ row.label }}
              </td>
              <td
                v-for="col in scoreRows.cols"
                :key="col.key"
                class="px-3 py-2 text-right tabular-nums"
              >
                {{ col.scores[row.key] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-muted">
        Verified ratings are placed on the scale from ZwiftInsider's bot tests (seconds gained per hour on Tempus Fugit and Alpe du Zwift at 300 W). Estimated ones are a name-based guess, pinned so that an unmeasured part never outranks a measured one.
      </p>
    </section>

    <section class="space-y-3">
      <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">
        Physics the simulator runs on
      </h3>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50">
            <tr class="text-left text-muted">
              <th class="px-3 py-2 font-medium">
                Part
              </th>
              <th class="px-3 py-2 font-medium text-right">
                <UTooltip text="Drag area (coefficient of drag x frontal area), in square metres, relative to the reference bike. Negative is slipperier.">
                  <span class="underline decoration-dotted">CdA Δ</span>
                </UTooltip>
              </th>
              <th class="px-3 py-2 font-medium text-right">
                <UTooltip text="Bike mass relative to the reference bike, in kilograms. Negative is lighter.">
                  <span class="underline decoration-dotted">Mass Δ</span>
                </UTooltip>
              </th>
              <th class="px-3 py-2 font-medium text-right">
                <UTooltip text="Rolling-resistance offset from a frame's stage-3 drivetrain upgrade. Wheels carry none: their rolling resistance is set by their class and the surface.">
                  <span class="underline decoration-dotted">Crr Δ</span>
                </UTooltip>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in physicsRows"
              :key="row.label"
              class="border-t border-default"
            >
              <td class="px-3 py-2">
                {{ row.label }}
              </td>
              <template v-if="row.physics">
                <td class="px-3 py-2 text-right tabular-nums">
                  {{ signed(row.physics.cdaDeltaM2, 4) }} m²
                </td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {{ signed(row.physics.bikeMassDeltaKg, 2) }} kg
                </td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {{ row.physics.crrDelta ? signed(row.physics.crrDelta, 4) : '-' }}
                </td>
              </template>
              <td
                v-else
                colspan="3"
                class="px-3 py-2 text-muted"
              >
                Not measured - ridden at the rating-derived average for its class
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-muted">
        Deltas are solved from the measured gap-seconds against {{ baselineName }}, then added to it; the rider's own height and weight scale the total drag area.<template v-if="wheelset">
          Rolling resistance on gravel, dirt and cobbles comes only from the wheels' {{ CRR_CLASS_LABELS[wheelset.crrClass].toLowerCase() }} class - never from the frame.
        </template>
      </p>
    </section>
  </div>
</template>
