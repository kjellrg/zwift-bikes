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
  /**
   * Fetches the other wheelsets that fit this frame on this route, ranked and
   * timed by the same request the card itself came from (the endpoints'
   * `wheelsForFrame` drill-down). Supplied by the page, because only the page
   * knows the endpoint and the live query; omit it and the card simply shows
   * no wheel disclosure.
   */
  loadWheelOptions?: (frameId: number) => Promise<ComboScore[]>
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
const { openBikeDetail, syncBikeDetail } = useOverlays()
function bikeDetail() {
  return { combo: props.combo, route: props.route, fastestTimeSec: props.fastestTimeSec, laps: props.laps }
}
function showDetails() {
  openBikeDetail(bikeDetail())
}
// A refetch hands this card a new combo object; if the drawer is showing
// this bike, it follows - see `syncBikeDetail`.
watch(() => [props.combo, props.fastestTimeSec, props.laps], () => syncBikeDetail(bikeDetail()))

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

/** Same garage toggle as the card's own wheels, for a row of the disclosure below. */
function isWheelOptionOwned(option: ComboScore): boolean {
  return !!option.wheelset && isWheelOwned(option.wheelset.key)
}
function toggleWheelOptionOwned(option: ComboScore) {
  if (!option.wheelset) return
  setWheelOwned(option.wheelset.key, !isWheelOptionOwned(option))
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

/**
 * The other wheels that fit this bike, behind a disclosure.
 *
 * The list itself is fetched on demand rather than shipped with every row, so
 * a page that nobody expands costs exactly what it did before - the drill-down
 * is ~21 route simulations against the 54 a first page already spends, and
 * paying that for nine rows up front would have doubled the page. `wheelOptions`
 * on the combo is only the COUNT, which the endpoint gets for free while it is
 * already holding the ranked pool, and it is what decides whether there is a
 * disclosure to offer at all.
 */
const wheelOptionsOpen = ref(false)
const wheelOptions = ref<ComboScore[]>([])
const wheelOptionsStatus = ref<'idle' | 'loading' | 'error'>('idle')
const canShowWheelOptions = computed(() =>
  Boolean(props.loadWheelOptions) && !!props.combo.wheelset && (props.combo.wheelOptions ?? 1) > 1
)
/** Gaps in the list are against its own fastest row, not the page's - the question being answered is "which wheels for THIS bike", so the frame's own best is the zero. */
const bestWheelSec = computed(() => wheelOptions.value[0]?.finishTimeSec)

async function fetchWheelOptions() {
  if (!props.loadWheelOptions) return
  wheelOptionsStatus.value = 'loading'
  try {
    wheelOptions.value = await props.loadWheelOptions(props.combo.frame.id)
    wheelOptionsStatus.value = 'idle'
  } catch {
    wheelOptionsStatus.value = 'error'
  }
}

function toggleWheelOptions() {
  wheelOptionsOpen.value = !wheelOptionsOpen.value
  if (wheelOptionsOpen.value && !wheelOptions.value.length && wheelOptionsStatus.value !== 'loading') fetchWheelOptions()
}

// A garage toggle, a filter or a rider-profile change re-ranks everything,
// including these times - and Vue reuses this component when the row keeps its
// key. Dropping the cached list rather than leaving it up is the difference
// between an open drawer that follows the ranking and one quietly showing the
// times from before the change.
watch(() => props.combo, () => {
  wheelOptions.value = []
  if (wheelOptionsOpen.value) fetchWheelOptions()
})
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

    <!--
      One row per bike is the list's rule (the pages send
      `maxWheelsetsPerFrame=1`), so this is where a frame's other wheels live.
      It renders nothing at all unless the endpoint counted more than one real
      wheel answer for this frame, which keeps it off every fixed-wheel bike
      and off any pool filtered down to a single wheelset.
    -->
    <div v-if="canShowWheelOptions">
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        class="px-0"
        :icon="wheelOptionsOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        :aria-expanded="wheelOptionsOpen"
        @click="toggleWheelOptions"
      >
        {{ combo.wheelOptions }} wheel options for this bike
      </UButton>

      <div
        v-if="wheelOptionsOpen"
        class="mt-2 rounded-lg border border-default divide-y divide-default"
      >
        <p
          v-if="wheelOptionsStatus === 'loading'"
          class="flex items-center gap-1.5 px-3 py-2 text-sm text-muted"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-4 animate-spin"
          />Working out the wheels…
        </p>
        <p
          v-else-if="wheelOptionsStatus === 'error'"
          class="px-3 py-2 text-sm text-muted"
        >
          Couldn't load the wheel options.
          <UButton
            color="neutral"
            variant="link"
            size="xs"
            class="px-0"
            @click="fetchWheelOptions"
          >
            Try again
          </UButton>
        </p>
        <div
          v-for="option in wheelOptions"
          v-else
          :key="option.wheelset?.key ?? 'fixed'"
          class="flex items-center gap-2 px-3 py-1.5 text-sm"
        >
          <UTooltip
            :text="isWheelOptionOwned(option) ? 'Remove wheels from garage' : 'Quick-add wheels to garage'"
          >
            <UButton
              :icon="isWheelOptionOwned(option) ? 'i-lucide-circle-check' : 'i-lucide-circle-plus'"
              size="xs"
              :color="isWheelOptionOwned(option) ? 'success' : 'neutral'"
              variant="ghost"
              class="opacity-50 hover:opacity-100"
              :aria-label="`${isWheelOptionOwned(option) ? 'Remove' : 'Quick-add'} ${option.wheelset?.name} ${isWheelOptionOwned(option) ? 'from' : 'to'} garage`"
              @click="toggleWheelOptionOwned(option)"
            />
          </UTooltip>
          <span class="min-w-0 flex-1 break-words">{{ option.wheelset?.name }}</span>
          <UBadge
            v-if="option.wheelset && combo.wheelset && option.wheelset.key === combo.wheelset.key"
            color="primary"
            variant="subtle"
            size="sm"
          >
            picked
          </UBadge>
          <span
            v-if="option.finishTimeSec !== undefined && bestWheelSec !== undefined"
            class="shrink-0 tabular-nums"
            :class="option.finishTimeSec - bestWheelSec > 0 ? 'text-warning' : 'text-primary'"
          >{{ option.finishTimeSec - bestWheelSec > 0 ? formatDurationGap(option.finishTimeSec - bestWheelSec) : formatDuration(option.finishTimeSec) }}</span>
        </div>
        <!--
          The count on the button is the whole pool's; the list is the best few
          of it. Saying which is which keeps the button from reading as a
          promise of 62 rows.
        -->
        <p
          v-if="wheelOptionsStatus === 'idle' && wheelOptions.length && (combo.wheelOptions ?? 0) > wheelOptions.length"
          class="px-3 py-1.5 text-xs text-muted"
        >
          Fastest {{ wheelOptions.length }} of {{ combo.wheelOptions }} on this route.
        </p>
      </div>
    </div>
  </UCard>
</template>
