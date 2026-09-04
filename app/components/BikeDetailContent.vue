<script setup lang="ts">
import type { ClassifiedWheel, ComboScore, EquipmentPhysicsDelta } from '../../shared/types/catalog'
import type { BikeDetail } from '../composables/useOverlays'

/**
 * Everything the app knows about one frame+wheelset combo, laid out as a
 * drawer. Deliberately presentation-only: every number comes from the
 * `ComboScore` the result card already holds (scores, confidence, solved
 * physics deltas, breakdown, finish time), so opening it costs no request
 * and can never disagree with the card it was opened from.
 */
const props = defineProps<{ detail: BikeDetail }>()

const { owned, load, setOwned, setWheelOwned, isWheelOwned } = useGarage()
const { defaultUnownedLevel, powerW } = useRiderProfile()
const { bikeDetailDropped, rankedFastestTimeSec } = useOverlays()
onMounted(() => load())

/**
 * A bike that a level change pushed off every loaded page has no card to
 * sync the drawer from (`syncBikeDetail`), so the drawer fetches it itself
 * through the page's per-frame drill-down, which ranks this frame's wheels
 * under the live query regardless of where the frame sits overall. The
 * fastest of those is the combo the card would have shown. Held apart from
 * the snapshot in `detail` and cleared whenever a card syncs a fresh one.
 */
const refetched = ref<ComboScore>()
const refetching = ref(false)
let refetchToken = 0
watch(() => props.detail, () => {
  refetched.value = undefined
})

const combo = computed(() => refetched.value ?? props.detail.combo)
const frame = computed(() => combo.value.frame)
const wheelset = computed(() => combo.value.wheelset)

const isOwnedFrame = computed(() => owned.value[frame.value.id] !== undefined)
const ownedFrameLevel = computed(() => owned.value[frame.value.id])
// The level the bike is scored at right now: the garage's, which moves the
// instant a level button is pressed, ahead of any refetch.
const currentLevel = computed(() => ownedFrameLevel.value ?? frame.value.level)

/**
 * What upgrading this bike is worth on the route being ranked, in seconds off
 * this ride at each stage - the drawer's one number that cannot come from the
 * card, since the card holds one stage and this is six. It arrives on the
 * fastest combo of the same per-frame drill-down the card's wheel list uses
 * (`ComboScore.upgradeFinishTimesSec`), so opening the drawer costs the
 * request the "other wheels" disclosure would have cost anyway, and both
 * views agree because they are one response.
 *
 * Refetched when the frame changes or when its fastest wheel does, and NOT on
 * every level change: the six stage times are a property of the bike and the
 * course, not of the stage the rider is on, so a level change only moves the
 * marker. It does change which wheel is fastest sometimes, and that is what
 * the wheelset key in the watch is there to catch.
 *
 * That request costs five extra route integrations, so on a long route the
 * wide chart lands a second or two after the two bot-test curves beside it,
 * which used to shove the whole section down under the reader's eyes. Hence
 * `routeUpgradeLoading`: the drawer holds the chart's exact height from the
 * moment it opens. It deliberately holds nothing when there is nothing to
 * wait for - no rider profile means the endpoint never sends a curve - and it
 * collapses rather than pulsing on when a request comes back without one,
 * which is what legacy and compare physics mode and a failed request produce.
 */
const routeUpgradeTimesSec = ref<number[]>()
const routeUpgradeLoading = ref(false)
// What the loaded curve is for. The dropped-bike refetch below answers the
// same request, so it hands its own response over rather than letting the
// watcher fire a second, identical one.
const curveKey = ref<string>()
let curveToken = 0

function takeUpgradeCurve(combos: ComboScore[], key: string) {
  routeUpgradeTimesSec.value = combos[0]?.upgradeFinishTimesSec
  curveKey.value = key
}

watch([() => props.detail.combo.frame.id, () => wheelset.value?.key], async ([frameId, wheelsetKey]) => {
  const key = `${frameId}:${wheelsetKey ?? 'fixed'}`
  if (key === curveKey.value) return
  const token = ++curveToken
  routeUpgradeTimesSec.value = undefined
  curveKey.value = undefined
  if (!props.detail.loadFrameCombos) return
  routeUpgradeLoading.value = true
  try {
    const combos = await props.detail.loadFrameCombos(frameId)
    if (token !== curveToken) return
    takeUpgradeCurve(combos, key)
  } catch {
    // The two bot-test curves below still answer the question in the
    // abstract; a failed request just means this drawer does not also answer
    // it for this course.
  } finally {
    if (token === curveToken) routeUpgradeLoading.value = false
  }
}, { immediate: true })

/**
 * Seconds saved against the just-bought bike at each stage, which is the same
 * "higher is better" shape the bot-test curves are already drawn in - finish
 * times themselves run the other way.
 */
const routeUpgradeGainsSec = computed(() => {
  const times = routeUpgradeTimesSec.value
  if (!times || times.length < 2 || times[0] === undefined) return undefined
  return times.map(time => times[0]! - time)
})

/**
 * Whether to hold the chart's space instead of showing it. `finishTimeSec` is
 * the client-side proxy for "the endpoint can answer at all", since a curve is
 * only produced with a rider profile and in dynamic physics mode; the drawer
 * cannot see the physics mode, so in legacy or compare mode the placeholder
 * shows for the length of the request and then collapses - exactly what a
 * failed request does, and both of those modes are debug views.
 */
const routeUpgradePending = computed(() =>
  !routeUpgradeGainsSec.value
  && finishTimeSec.value !== undefined
  && (routeUpgradeLoading.value || refetching.value))

// A fixed short label, with the course named in the caption below it: a route
// name in the chart header would squeeze the figures beside it, and some of
// them are long ("2022 Cycling Esports World Championships Route").
const routeUpgradeLabel = 'On this route'
const routeUpgradeText = computed(() => {
  const laps = props.detail.laps ?? 1
  const rideText = props.detail.route
    ? `${laps > 1 ? `${laps} laps of ` : ''}${props.detail.route.name}`
    : 'this ride'
  const wheelText = wheelset.value ? ` on ${wheelset.value.name}` : ''
  return `Seconds off ${rideText} at ${Math.round(powerW.value)} W${wheelText}, simulated at each stage over the route's own terrain.`
})

watch([bikeDetailDropped, ownedFrameLevel], async ([dropped]) => {
  if (!dropped || !props.detail.loadFrameCombos) return
  const token = ++refetchToken
  refetching.value = true
  try {
    const combos = await props.detail.loadFrameCombos(props.detail.combo.frame.id)
    // Superseded by a newer refetch, or by the bike ranking again (a card
    // has synced a fresh combo since): this answer is for a state that is gone.
    if (token !== refetchToken || !bikeDetailDropped.value) return
    if (combos[0]) {
      refetched.value = combos[0]
      // Same frame, same query, same response the curve watcher would have
      // asked for - claim it here so a level change that drops the bike does
      // not fetch this twice.
      takeUpgradeCurve(combos, `${combos[0].frame.id}:${combos[0].wheelset?.key ?? 'fixed'}`)
    }
  } catch {
    // Leave the previous numbers up; the notice already says they predate the change.
  } finally {
    if (token === refetchToken) refetching.value = false
  }
}, { immediate: true })
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
// A dropped bike's own snapshot of the fastest time predates the change;
// the list's current fastest is what it now trails.
const fastestTimeSec = computed(() => (bikeDetailDropped.value ? rankedFastestTimeSec.value : undefined) ?? props.detail.fastestTimeSec)
const gapSec = computed(() => finishTimeSec.value !== undefined && fastestTimeSec.value !== undefined
  ? Math.max(0, finishTimeSec.value - fastestTimeSec.value)
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

// Zwift's own names for the scheme, matching docs/bike-upgrade-levels.md.
const UPGRADE_AXIS_LABELS = { distance: 'distance', duration: 'duration', elevation: 'elevation' } as const
const UPGRADE_TIER_LABELS = { entry: 'entry-level', mid: 'mid-range', high: 'high-end' } as const
const upgradeSchemeText = computed(() => frame.value.upgradeScheme
  ? `${UPGRADE_TIER_LABELS[frame.value.upgradeScheme.tier]} frame, stages earned by ${UPGRADE_AXIS_LABELS[frame.value.upgradeScheme.axis]}`
  : undefined)
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

    <UAlert
      v-if="bikeDetailDropped"
      color="warning"
      variant="subtle"
      icon="i-lucide-arrow-down-to-line"
      title="This bike has dropped off the results you have loaded"
      :description="`At level ${currentLevel} it is slow enough to rank below every bike shown. ${refetching ? 'Fetching its numbers at this level.' : refetched ? 'The numbers below are for this level.' : 'The numbers below are from before the change.'} Once you close this drawer it will not be listed until you show more results or raise its level.`"
    />

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

    <section
      v-if="frame.upgradeCurve"
      class="space-y-3"
    >
      <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">
        What upgrading does
      </h3>
      <div
        v-if="routeUpgradeGainsSec"
        class="rounded-lg border border-default p-3 space-y-2"
      >
        <UpgradeSparkline
          :values="routeUpgradeGainsSec"
          :level="currentLevel"
          :label="routeUpgradeLabel"
          unit="s"
          wide
        />
        <p class="text-xs text-muted">
          {{ routeUpgradeText }}
        </p>
      </div>
      <!-- Same box, same rows, same heights as the block above, so the chart
           replaces it without moving anything: the label and caption are known
           before the request and render for real, the chart's own `w-full`
           viewBox of 264x40 is an aspect ratio, and the stage-number row is one
           10px line box whether it holds digits or skeletons. -->
      <div
        v-else-if="routeUpgradePending"
        class="rounded-lg border border-default p-3 space-y-2"
        aria-busy="true"
      >
        <div class="space-y-1">
          <div class="flex items-baseline justify-between gap-2 text-xs">
            <span class="font-medium text-highlighted">{{ routeUpgradeLabel }}</span>
            <USkeleton class="h-3 w-28" />
          </div>
          <USkeleton class="w-full aspect-[264/40] rounded" />
          <div class="flex h-[1lh] items-center justify-between text-[10px]">
            <USkeleton
              v-for="stage in 6"
              :key="stage"
              class="h-2.5 w-1.5"
            />
          </div>
        </div>
        <p class="text-xs text-muted">
          {{ routeUpgradeText }}
        </p>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <UpgradeSparkline
          :values="frame.upgradeCurve.flat"
          :level="currentLevel"
          label="Flat"
        />
        <UpgradeSparkline
          :values="frame.upgradeCurve.climb"
          :level="currentLevel"
          label="Climb"
        />
      </div>
      <p class="text-xs text-muted">
        Seconds saved per hour over the just-bought bike at each stage, from ZwiftInsider's bot tests at 300 W (flat: Tempus Fugit, climb: Alpe du Zwift).<template v-if="upgradeSchemeText">
          A {{ upgradeSchemeText }}.
        </template>
        A stage that adds nothing on one test is real: each stage upgrades one thing, and an aero stage barely shows uphill.
      </p>
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
