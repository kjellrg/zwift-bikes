<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from "../../shared/types/catalog";

const props = defineProps<{
  combo: ComboScore;
  rank: number;
  route?: RouteWithMeta;
  weightKg?: number;
  heightCm?: number;
  wkg?: number;
  /** Lap count to assume for finish-time/distance display when computing a fallback client-side estimate (see `finishTimeSec` below) - the server already bakes laps into `combo.finishTimeSec` when a rider profile is set, so this is mostly a fallback/display concern. Defaults to 1. */
  laps?: number;
  /** Fastest `finishTimeSec` among all currently-shown combos, used to show a "+Xs slower" gap instead of this card's own absolute time. */
  fastestTimeSec?: number;
  /** Frames the rider owns, keyed by frame id, mapped to their upgrade level - used to label whether `combo.frame.level` is an owned level or the rider's assumed default for unowned bikes. */
  owned?: Record<number, number>;
}>();

const isOwnedFrame = computed(
  () => props.owned?.[props.combo.frame.id] !== undefined,
);
const ownedFrameLevel = computed(() => props.owned?.[props.combo.frame.id]);

/** Quick-add-to-garage support: lets riders mark a bike/wheel as owned directly from a result card, without visiting the Garage page. */
const { setOwned, setWheelOwned, isWheelOwned } = useGarage();

/** New quick-adds start at whatever level the rider has chosen in Profile as their default for unowned bikes (e.g. "show everything at level 5"), rather than always level 1 - matching how that same default already drives the level unowned bikes are scored/displayed at everywhere else. */
const { defaultUnownedLevel } = useRiderProfile();

function toggleFrameOwned() {
  setOwned(
    props.combo.frame.id,
    isOwnedFrame.value ? null : defaultUnownedLevel.value,
  );
}

/** Lets riders adjust the owned upgrade level (1-5) right from the card, via the subtle level bar shown once a frame is owned. */
function setFrameLevel(level: number) {
  setOwned(props.combo.frame.id, level);
}

const isOwnedWheel = computed(
  () => !!props.combo.wheelset && isWheelOwned(props.combo.wheelset.key),
);

function toggleWheelOwned() {
  if (!props.combo.wheelset) return;
  setWheelOwned(props.combo.wheelset.key, !isOwnedWheel.value);
}

const finishTimeSec = computed(() => {
  if (props.combo.finishTimeSec !== undefined) return props.combo.finishTimeSec;
  if (!props.route || !props.weightKg || !props.heightCm || !props.wkg) return undefined;
  return estimateFinishTimeSec(
    props.route,
    props.combo.frame,
    props.combo.wheelset,
    props.weightKg,
    props.heightCm,
    props.wkg,
    props.laps ?? 1,
  );
});

/** Total ride distance (lead-in + laps x lap distance) used for the km/h display, so it matches whatever lap count is currently selected rather than always assuming a single lap. */
const totalDistanceKm = computed(() => {
  if (!props.route) return undefined;
  return computeRouteTotals(props.route, props.laps ?? 1).distanceKm;
});

/**
 * Only the fastest combo shows its absolute time - every other card shows how far behind it is, per user request.
 * The tie check quantises the gap exactly the way `formatDurationDelta` does (hundredths of a second), so the two
 * can never disagree: comparing at whole seconds used to mark two cards 0.4s apart as both `fastest`.
 */
const isFastest = computed(() => {
  return (
    finishTimeSec.value !== undefined &&
    props.fastestTimeSec !== undefined &&
    Math.round((finishTimeSec.value - props.fastestTimeSec) * 100) <= 0
  );
});
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
            <p class="font-semibold text-highlighted">
              {{ combo.frame.name }}
            </p>
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
              v-if="isOwnedFrame"
              text="Your upgrade level for this bike (1 = just unlocked, 5 = fully upgraded)"
            >
              <div class="flex items-center gap-0.5">
                <button
                  v-for="level in 5"
                  :key="level"
                  type="button"
                  class="flex size-4 items-center justify-center rounded text-[10px] font-medium transition-colors"
                  :class="
                    level === ownedFrameLevel
                      ? 'bg-primary text-inverted'
                      : 'bg-elevated text-muted hover:bg-accented'
                  "
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
      <div class="text-right">
        <p class="text-2xl font-bold text-primary">
          {{ combo.score }}
        </p>
        <p class="text-xs text-muted">match score</p>
      </div>
    </div>

    <div
      v-if="finishTimeSec"
      class="flex flex-wrap items-center gap-1.5 text-sm text-highlighted"
    >
      <UIcon name="i-lucide-timer" class="size-4" />
      <span v-if="isFastest || fastestTimeSec === undefined"
        >Est. finish time:
        <span class="font-semibold">{{
          formatDuration(finishTimeSec)
        }}</span></span
      >
      <span v-else class="font-semibold text-warning">{{
        formatDurationDelta(finishTimeSec - fastestTimeSec)
      }}</span>
      <span v-if="route && totalDistanceKm !== undefined" class="text-muted"
        >({{ formatSpeedKmh(totalDistanceKm, finishTimeSec) }})</span
      >
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <BikeCategoryBadge :category="combo.frame.category" />
      <UBadge v-if="combo.frame.style" color="neutral" variant="subtle">
        {{ combo.frame.style }} style
      </UBadge>
      <UBadge color="neutral" variant="subtle">
        {{
          combo.wheelset
            ? WHEEL_CATEGORY_LABELS[combo.wheelset.front.category]
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
        <UBadge color="neutral" variant="subtle" icon="i-lucide-lock">
          wheels fixed
        </UBadge>
      </UTooltip>
      <UTooltip
        :text="
          isOwnedFrame
            ? `Scored at your owned upgrade level for this bike`
            : `You don't own this bike - scored at your default assumed level for unowned bikes (change on the Profile page)`
        "
      >
        <UBadge color="neutral" variant="subtle" icon="i-lucide-gauge">
          Level {{ combo.frame.level }}
        </UBadge>
      </UTooltip>
    </div>

    <ScoreBreakdown :breakdown="combo.breakdown" />
  </UCard>
</template>
