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

/**
 * Lets riders adjust the owned upgrade level (0-5) right from the card: the
 * "Level N" badge of an owned frame opens a popover with a slider. The
 * slider follows the same commit-on-release pattern as the profile sliders
 * (#155): dragging only moves `pendingLevel`, the garage - and with it the
 * recommend refetch - updates on release.
 */
const pendingLevel = ref(0)
const levelPopoverOpen = ref(false)
watch(levelPopoverOpen, (open) => {
  if (open) pendingLevel.value = ownedFrameLevel.value ?? defaultUnownedLevel.value
})
function commitFrameLevel() {
  if (pendingLevel.value !== ownedFrameLevel.value) setOwned(props.combo.frame.id, pendingLevel.value)
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
 * and the fallback never ran. (Removing it does not slim the client bundle:
 * the speed chart and the TTT race plan simulate in the browser and pull the
 * same equipment-physics table through their own imports.)
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
    <!--
      The name column must be allowed to shrink (`min-w-0`) and its rows to
      wrap: flex children otherwise refuse to go narrower than their widest
      unbreakable content, and on a phone the frame name plus its buttons
      pushed the `shrink-0` time column out through the card's edge - the
      headline number was the thing that got clipped. The time column is
      kept narrow for the same reason: the gap's "slower" and the km/h go
      on the caption line, so the wheel name keeps the width on every card,
      not just the fastest one.
    -->
    <div class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-start gap-3">
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary"
        >
          {{ rank }}
        </div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-1">
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
          </div>
          <div class="flex flex-wrap items-center gap-1">
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
          {{ formatDurationGap(finishTimeSec - fastestTimeSec!) }}
        </p>
        <p class="text-xs text-muted">
          {{ isFastest || fastestTimeSec === undefined ? 'est. finish time' : 'slower' }}<span
            v-if="route && totalDistanceKm !== undefined"
            class="block sm:inline"
          ><span class="hidden sm:inline"> · </span>{{ formatSpeedKmh(totalDistanceKm, finishTimeSec) }}</span>
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
      <!--
        An owned frame's level is a button that looks like the badge next to
        it but reads as clickable (chevron, hover ring): it opens a slider
        rather than a row of six digits, which sat oddly among the badges.
      -->
      <UPopover
        v-if="isOwnedFrame && combo.frame.confidence === 'measured'"
        v-model:open="levelPopoverOpen"
        :ui="{ content: 'p-3 w-64' }"
      >
        <UTooltip text="Your upgrade level for this bike - click to change it">
          <UButton
            color="neutral"
            variant="subtle"
            size="xs"
            icon="i-lucide-gauge"
            trailing-icon="i-lucide-chevron-down"
            :aria-label="`Change upgrade level for ${combo.frame.name}, currently level ${combo.frame.level}`"
          >
            Level {{ combo.frame.level }}
          </UButton>
        </UTooltip>
        <template #content>
          <div class="space-y-2">
            <label class="block text-xs font-medium text-muted">Upgrade level: {{ pendingLevel }}</label>
            <USlider
              :model-value="pendingLevel"
              :min="0"
              :max="5"
              :step="1"
              :aria-label="`Upgrade level for ${combo.frame.name}`"
              @update:model-value="(value: number | undefined) => { pendingLevel = value ?? pendingLevel }"
              @change="commitFrameLevel"
            />
            <p class="text-xs text-muted">
              0 = stock, just purchased · 5 = fully upgraded
            </p>
          </div>
        </template>
      </UPopover>
      <UTooltip
        v-else-if="combo.frame.confidence === 'measured'"
        text="You don't own this bike - scored at your default assumed level for unowned bikes (change on the Profile page)"
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
