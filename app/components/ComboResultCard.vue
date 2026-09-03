<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'

const props = defineProps<{
  combo: ComboScore
  rank: number
  /** Only read for the km/h figure next to the finish time - the time itself is always the server's (`combo.finishTimeSec`). */
  route?: RouteWithMeta
  /** Lap count the shown time was computed for, so the km/h figure divides by the same distance. Defaults to 1. */
  laps?: number
  /** Fastest `finishTimeSec` among all currently-shown combos, used to show a "+Xs slower" gap instead of this card's own absolute time. */
  fastestTimeSec?: number
  /** Frames the rider owns, keyed by frame id, mapped to their upgrade level - used to label whether `combo.frame.level` is an owned level or the rider's assumed default for unowned bikes. */
  owned?: Record<number, number>
}>()

const isOwnedFrame = computed(
  () => props.owned?.[props.combo.frame.id] !== undefined
)
const ownedFrameLevel = computed(() => props.owned?.[props.combo.frame.id])

/** Quick-add-to-garage support: lets riders mark a bike/wheel as owned directly from a result card, without visiting the Garage page. */
const { setOwned, setWheelOwned, isWheelOwned } = useGarage()

/**
 * Opens the detail drawer for this combo. An explicit control rather than a
 * clickable card: the card already hosts the garage toggles and the level
 * bar, and nested interactive elements inside one big click target break
 * keyboard semantics. The frame name is a second trigger for discoverability.
 */
const { openBikeDetail } = useOverlays()
function showDetails() {
  openBikeDetail({ combo: props.combo, route: props.route, fastestTimeSec: props.fastestTimeSec, laps: props.laps })
}

/**
 * New quick-adds start at the rider's chosen default level for unowned bikes
 * (see Profile), the same level unowned bikes are scored and displayed at
 * everywhere else - so adding a bike never moves it in the ranking. The
 * garage modal's own add uses the same default; the two must agree, or the
 * same action persists a different level depending on where it was clicked.
 */
const { defaultUnownedLevel } = useRiderProfile()

function toggleFrameOwned() {
  setOwned(
    props.combo.frame.id,
    isOwnedFrame.value ? null : defaultUnownedLevel.value
  )
}

/** Lets riders adjust the owned upgrade level (0-5) right from the card, via the subtle level bar shown once a frame is owned. */
function setFrameLevel(level: number) {
  setOwned(props.combo.frame.id, level)
}

const isOwnedWheel = computed(
  () => !!props.combo.wheelset && isWheelOwned(props.combo.wheelset.key)
)

function toggleWheelOwned() {
  if (!props.combo.wheelset) return
  setWheelOwned(props.combo.wheelset.key, !isOwnedWheel.value)
}

/**
 * Always the server's number. The card used to carry a client-side
 * `estimateFinishTimeSec` fallback for the profile-less case, but every page
 * sends the composable defaults, so the server always sets `finishTimeSec`
 * and the fallback never ran - while its import chain shipped the 96 KB
 * precomputed equipment-physics table to every visitor.
 */
const finishTimeSec = computed(() => props.combo.finishTimeSec)

/** Total ride distance (lead-in + laps x lap distance) used for the km/h display, so it matches whatever lap count is currently selected rather than always assuming a single lap. */
const totalDistanceKm = computed(() => {
  if (!props.route) return undefined
  return computeRouteTotals(props.route, props.laps ?? 1).distanceKm
})

/**
 * Only the fastest combo shows its absolute time - every other card shows how far behind it is, per user request.
 * The tie check quantises the gap exactly the way `formatDurationDelta` does (hundredths of a second), so the two
 * can never disagree: comparing at whole seconds used to mark two cards 0.4s apart as both `fastest`.
 */
const isFastest = computed(() => {
  return (
    finishTimeSec.value !== undefined
    && props.fastestTimeSec !== undefined
    && Math.round((finishTimeSec.value - props.fastestTimeSec) * 100) <= 0
  )
})

/** The card's headline number is the finish time; the 0-100 score only leads when there is no time to show. */
const showsTimeFirst = computed(() => finishTimeSec.value !== undefined)
</script>

<template>
  <UCard :ui="{ body: 'space-y-3' }">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-3">
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary"
        >
          {{ rank }}
        </div>
        <div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="font-semibold text-highlighted text-left hover:underline focus-visible:underline"
              :aria-label="`Details for ${combo.frame.name}`"
              @click="showDetails"
            >
              {{ combo.frame.name }}
            </button>
            <UTooltip text="Everything we know about this combo">
              <UButton
                icon="i-lucide-info"
                size="xs"
                color="neutral"
                variant="ghost"
                class="opacity-50 hover:opacity-100"
                :aria-label="`Details for ${combo.frame.name}`"
                @click="showDetails"
              />
            </UTooltip>
            <UTooltip
              :text="
                isOwnedFrame
                  ? 'Remove bike from garage'
                  : 'Quick-add bike to garage'
              "
            >
              <UButton
                :icon="
                  isOwnedFrame
                    ? 'i-lucide-circle-check'
                    : 'i-lucide-circle-plus'
                "
                size="xs"
                :color="isOwnedFrame ? 'success' : 'neutral'"
                variant="ghost"
                class="opacity-50 hover:opacity-100"
                :aria-label="
                  isOwnedFrame
                    ? 'Remove bike from garage'
                    : 'Quick-add bike to garage'
                "
                @click="toggleFrameOwned"
              />
            </UTooltip>
            <UTooltip
              v-if="isOwnedFrame && combo.frame.confidence === 'measured'"
              text="Your upgrade level for this bike (0 = stock, just purchased, 5 = fully upgraded)"
            >
              <div class="flex items-center gap-0.5">
                <button
                  v-for="level in [0, 1, 2, 3, 4, 5]"
                  :key="level"
                  type="button"
                  class="flex size-4 items-center justify-center rounded text-[10px] font-medium transition-colors"
                  :class="
                    level === ownedFrameLevel
                      ? 'bg-primary text-inverted'
                      : 'bg-elevated text-muted hover:bg-accented'
                  "
                  :aria-label="`Set upgrade level ${level} for ${combo.frame.name}`"
                  :aria-pressed="level === ownedFrameLevel"
                  @click="setFrameLevel(level)"
                >
                  {{ level }}
                </button>
              </div>
            </UTooltip>
          </div>
          <div class="flex items-center gap-1">
            <p class="text-sm text-muted">
              {{
                combo.wheelset
                  ? combo.wheelset.name
                  : "Fixed disc wheels (not swappable)"
              }}
            </p>
            <UTooltip
              v-if="combo.wheelset"
              :text="
                isOwnedWheel
                  ? 'Remove wheels from garage'
                  : 'Quick-add wheels to garage'
              "
            >
              <UButton
                :icon="
                  isOwnedWheel
                    ? 'i-lucide-circle-check'
                    : 'i-lucide-circle-plus'
                "
                size="xs"
                :color="isOwnedWheel ? 'success' : 'neutral'"
                variant="ghost"
                class="opacity-50 hover:opacity-100"
                :aria-label="
                  isOwnedWheel
                    ? 'Remove wheels from garage'
                    : 'Quick-add wheels to garage'
                "
                @click="toggleWheelOwned"
              />
            </UTooltip>
          </div>
        </div>
      </div>
      <!--
        The headline number is what the list is ranked by: the finish time
        once a profile exists (always, in practice). The 0-100 match score
        used to sit here in the largest type on the card while the time it
        outranked was a small line below - inverted hierarchy.
      -->
      <div
        v-if="showsTimeFirst && finishTimeSec !== undefined"
        class="text-right shrink-0"
      >
        <p
          v-if="isFastest || fastestTimeSec === undefined"
          class="text-2xl font-bold text-primary tabular-nums"
        >
          {{ formatDuration(finishTimeSec) }}
        </p>
        <p
          v-else
          class="text-2xl font-bold text-warning tabular-nums"
        >
          {{ formatDurationDelta(finishTimeSec - fastestTimeSec!) }}
        </p>
        <p class="text-xs text-muted">
          {{ isFastest || fastestTimeSec === undefined ? 'est. finish time' : 'behind the fastest' }}<template v-if="route && totalDistanceKm !== undefined">
            · {{ formatSpeedKmh(totalDistanceKm, finishTimeSec) }}
          </template>
        </p>
      </div>
      <div
        v-else
        class="text-right shrink-0"
      >
        <p class="text-2xl font-bold text-primary">
          {{ combo.score }}
        </p>
        <p class="text-xs text-muted">
          match score
        </p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <UTooltip
        v-if="showsTimeFirst"
        text="Match score, 0-100: how well the frame and wheels' aero, climbing and surface ratings fit this terrain. The ranking itself is by finish time."
      >
        <UBadge
          color="primary"
          variant="subtle"
          icon="i-lucide-target"
        >
          {{ combo.score }} match
        </UBadge>
      </UTooltip>
      <BikeCategoryBadge :category="combo.frame.category" />
      <UBadge
        v-if="combo.frame.style"
        color="neutral"
        variant="subtle"
      >
        {{ combo.frame.style }} style
      </UBadge>
      <UBadge
        color="neutral"
        variant="subtle"
      >
        {{
          combo.wheelset
            ? WHEEL_CATEGORY_LABELS[combo.wheelset.rear.category]
            : "Fixed disc"
        }}
        wheels
      </UBadge>
      <UTooltip
        :text="
          combo.frame.confidence === 'measured'
            ? 'Frame aero/climb rating based on real ZwiftInsider bot speed-test data'
            : 'Frame aero/climb rating is a name-based estimate (no speed-test data for this frame yet)'
        "
      >
        <UBadge
          :color="combo.frame.confidence === 'measured' ? 'success' : 'neutral'"
          variant="subtle"
          :icon="
            combo.frame.confidence === 'measured'
              ? 'i-lucide-badge-check'
              : 'i-lucide-help-circle'
          "
        >
          frame
          {{ combo.frame.confidence === "measured" ? "verified" : "estimated" }}
        </UBadge>
      </UTooltip>
      <UTooltip
        v-if="combo.wheelset"
        :text="
          combo.wheelset.confidence === 'measured'
            ? 'Wheel aero/climb rating based on real ZwiftInsider bot speed-test data'
            : 'Wheel aero/climb rating is a name-based estimate (no speed-test data for this wheel yet)'
        "
      >
        <UBadge
          :color="
            combo.wheelset.confidence === 'measured' ? 'success' : 'neutral'
          "
          variant="subtle"
          :icon="
            combo.wheelset.confidence === 'measured'
              ? 'i-lucide-badge-check'
              : 'i-lucide-help-circle'
          "
        >
          wheels
          {{
            combo.wheelset.confidence === "measured" ? "verified" : "estimated"
          }}
        </UBadge>
      </UTooltip>
      <UTooltip
        v-else
        text="This frame comes with its own integrated disc wheels which cannot be changed in Zwift"
      >
        <UBadge
          color="neutral"
          variant="subtle"
          icon="i-lucide-lock"
        >
          wheels fixed
        </UBadge>
      </UTooltip>
      <UTooltip
        v-if="combo.frame.confidence === 'measured'"
        :text="
          isOwnedFrame
            ? `Scored at your owned upgrade level for this bike`
            : `You don't own this bike - scored at your default assumed level for unowned bikes (change on the Profile page)`
        "
      >
        <UBadge
          color="neutral"
          variant="subtle"
          icon="i-lucide-gauge"
        >
          Level {{ combo.frame.level }}
        </UBadge>
      </UTooltip>
    </div>

    <ScoreBreakdown :breakdown="combo.breakdown" />
  </UCard>
</template>
