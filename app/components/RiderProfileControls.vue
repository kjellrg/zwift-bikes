<script setup lang="ts">
import { TTT_MAX_CLIMB_WKG, TTT_MAX_RIDERS, TTT_MIN_CLIMB_WKG, TTT_MIN_RIDERS } from '#shared/utils/physics/draft'
import { POWER_W_RANGE, SPRINT_POWER_W_RANGE } from '#shared/utils/riderBounds'

/**
 * The rider box: weight/height/power sliders plus the draft disclosure and
 * its TTT controls, shared verbatim by the route, segment and event race
 * pages. Everything reads `useRiderProfile()` directly, whose state is
 * `useState`-backed, so the host page's own `watch([weightKg, ...])` refetch
 * wiring keeps firing exactly as it did when this markup lived inline.
 *
 * The exceptions to "no props" are properties of the PAGE, not the rider -
 * this component deliberately knows nothing about the route. `hasLongClimb`:
 * whether the team climb pace applies at all. `sprintPower`: which persisted
 * power value the slider edits. See each prop's own comment below.
 *
 * `loadRiderProfile()` runs here (child `onMounted` fires before the
 * parent's), immediately followed by the pending-slider seeding, preserving
 * the load-then-seed order the pages used - it matters for the one value the
 * watches below don't cover: a stored profile with a different power but no
 * committed team climb pace still seeds `pendingClimbWkg` from the loaded
 * power, not the default.
 */
const props = withDefaults(defineProps<{
  /**
   * Whether this route has a climb long enough for the team climb pace to do
   * anything - i.e. whether `detectLongClimbBlocks` finds one. The climb
   * slider hides when it doesn't: `tttPowerPlan` returns `undefined` with no
   * qualifying block, so
   * the setting would change no ranking and no displayed time, and roughly
   * two thirds of the route catalog is in that state.
   *
   * Defaults to `true` so a caller that hasn't got geometry to hand (or a
   * future page that forgets) degrades to the old always-visible behaviour
   * rather than silently losing the control.
   */
  hasLongClimb?: boolean
  /**
   * Whether the page this sits on races with no draft at all, in which case
   * the whole draft cluster is hidden rather than disabled: the host page has
   * already forced its ranking solo and said so in a banner, and leaving a
   * live-looking control that changes nothing would be a lie about what the
   * numbers below respond to. Like `hasLongClimb`, only the host page can know
   * this - it is a property of the race, not the rider - and the rider's saved
   * draft mode is left exactly as it was for every other page.
   */
  draftLocked?: boolean
  /**
   * Whether this page's slider edits the rider's SPRINT power - the separate
   * persisted watt value sprint segment pages use, with its own wider range
   * (see `SPRINT_POWER_W_RANGE`). A sprint effort is a different physical
   * quantity from race-pace power, so cranking a sprint to 1200 W must never
   * drag the rider's race setting along. Static per page: the segment page
   * resolves its data before this component mounts.
   */
  sprintPower?: boolean
}>(), { hasLongClimb: true, draftLocked: false, sprintPower: false })

const { weightKg, heightCm, powerW, sprintPowerW, draftMode, tttRiders, tttClimbWkg, load: loadRiderProfile, setWeightKg, setPowerW, setSprintPowerW, setHeightCm, setDraftMode, setTttRiders, setTttClimbWkg } = useRiderProfile()

// The persisted power this page's slider edits (see the `sprintPower` prop).
const activePowerW = computed(() => props.sprintPower ? sprintPowerW.value : powerW.value)
const powerRange = computed(() => props.sprintPower ? SPRINT_POWER_W_RANGE : POWER_W_RANGE)

onMounted(() => {
  loadRiderProfile()
  pendingWeightKg.value = weightKg.value
  pendingHeightCm.value = heightCm.value
  pendingPowerW.value = activePowerW.value
  pendingRiders.value = tttRiders.value
  pendingClimbWkg.value = tttClimbWkg.value ?? powerW.value / weightKg.value
})

const pendingWeightKg = ref(weightKg.value)
const pendingHeightCm = ref(heightCm.value)
const pendingPowerW = ref(activePowerW.value)
// Power is stored in watts, so committing weight leaves the wattage exactly
// where it is - only the derived W/kg readout in the label moves.
const commitWeight = () => setWeightKg(pendingWeightKg.value)
const commitHeight = () => setHeightCm(pendingHeightCm.value)
const commitPower = () => props.sprintPower ? setSprintPowerW(pendingPowerW.value) : setPowerW(pendingPowerW.value)
watch(weightKg, (value) => {
  pendingWeightKg.value = value
})
watch(heightCm, (value) => {
  pendingHeightCm.value = value
})
watch(activePowerW, (value) => {
  pendingPowerW.value = value
})

// Seeded from the rider's normal power (in W/kg, and always `powerW` - a
// sprint page's own wattage is the wrong quantity for a sustained climb),
// then left alone: there is deliberately no watch on the power state here, so
// moving the Power slider never drags the team's climb pace with it. Until it
// is committed the profile keeps it `undefined` and the recommend query omits
// it entirely, which is what makes "not set" mean "ride the climbs at your
// normal power" rather than "ride them at this number".
const pendingClimbWkg = ref(tttClimbWkg.value ?? powerW.value / weightKg.value)
const commitClimbWkg = () => setTttClimbWkg(pendingClimbWkg.value)
watch(tttClimbWkg, (value) => {
  if (value !== undefined) pendingClimbWkg.value = value
})

const pendingRiders = ref(tttRiders.value)
const commitRiders = () => setTttRiders(pendingRiders.value)
watch(tttRiders, (value) => {
  pendingRiders.value = value
})

const draftModeOptions = [{ label: 'Solo (no draft)', value: 'solo' }, { label: 'TTT (paceline)', value: 'ttt' }, { label: 'Race (pack draft)', value: 'race' }]
// The draft controls sit behind a disclosure. Solo is the default and covers
// almost every visit (a road race is not ridden as a paceline), so the
// paceline inputs stay folded away until someone asks for them - but ANY
// non-solo mode forces the section open, because a draft mode silently
// shifting every finish time on the page with no visible control is worse
// than one extra dropdown. That rule is deliberately written against
// `!== 'solo'` rather than `=== 'ttt'` so a future race/pack-draft mode
// (see `shared/utils/physics/draft.ts`) inherits it for free.
// `draftLocked` wins over both, including over a stored non-solo mode: on a
// no-draft race there is nothing the section could usefully show. It is what
// the host page's ranking is actually computed at, so the power label reads it
// too - the stored mode would otherwise call the rider's number an "average"
// over a rotation this page never applies.
const effectiveDraftMode = computed(() => props.draftLocked ? 'solo' : draftMode.value)
const showDraftControls = ref(false)
const draftControlsOpen = computed(() => !props.draftLocked && (showDraftControls.value || draftMode.value !== 'solo'))

// "(edit profile)" opens the profile modal over this page rather than
// navigating away from the route the rider is looking at - its edits are
// written straight through `useRiderProfile`, so the ranking below refreshes
// underneath the modal. A plain `<a href="/profile">` rather than a ULink:
// deep links and modifier-click still reach the real page, and vue-router's
// own click handler would otherwise run before `preventDefault`.
const { openProfile } = useOverlays()
</script>

<template>
  <!-- Two fixed rows rather than one wrapping one: the rider's own numbers stay
       on the first, everything about the group on the second. Switching draft
       mode then only fills in the second row's spare width instead of pushing a
       control onto a new line, so the page below barely moves. Collapsed, that
       second row is a single opt-in button - see `draftControlsOpen`. -->
  <div class="rounded-lg border border-default p-4 space-y-4">
    <div class="flex flex-wrap items-end gap-6">
      <div class="w-full sm:w-44">
        <label class="block text-xs font-medium text-muted mb-1">Rider weight: {{ pendingWeightKg }} kg</label>
        <input
          v-model.number="pendingWeightKg"
          type="range"
          min="40"
          max="130"
          step="1"
          class="w-full cursor-pointer"
          aria-label="Rider weight in kilograms"
          @change="commitWeight"
        >
      </div>
      <div class="w-full sm:w-56">
        <label class="block text-xs font-medium text-muted mb-1">Height: {{ pendingHeightCm }} cm</label>
        <input
          v-model.number="pendingHeightCm"
          type="range"
          min="100"
          max="220"
          step="1"
          class="w-full cursor-pointer"
          aria-label="Rider height"
          @change="commitHeight"
        >
      </div>
      <div class="min-w-64 flex-1">
        <label class="block text-xs font-medium text-muted mb-1">Power: {{ pendingPowerW }} W ({{ (pendingPowerW / weightKg).toFixed(2) }} W/kg){{ effectiveDraftMode === 'solo' ? '' : ' average' }}</label>
        <input
          v-model.number="pendingPowerW"
          type="range"
          :min="powerRange.min"
          :max="powerRange.max"
          :step="powerRange.step"
          class="w-full cursor-pointer"
          aria-label="Rider power in watts"
          @change="commitPower"
        >
      </div>
    </div>
    <div class="flex flex-wrap items-end gap-6">
      <UButton
        v-if="!draftControlsOpen && !props.draftLocked"
        color="neutral"
        variant="subtle"
        size="xs"
        icon="i-lucide-users"
        @click="showDraftControls = true"
      >
        Riding this in a group? Add draft
      </UButton>
      <div
        v-if="draftControlsOpen"
        class="w-44"
      >
        <label class="block text-xs font-medium text-muted mb-1">Draft <UTooltip text="Solo is a lone rider, no draft (how ZwiftInsider's bot tests ride). TTT is a rotating paceline: your power stays YOUR average over a full rotation - you push well above it while pulling and sit below it in the wheels - and the group moves at the speed that combined effort produces. Race is a mass-start bunch: one draft benefit measured from real race fields, with your power still your own race average."><UIcon
          name="i-lucide-info"
          class="size-3 text-muted align-text-bottom"
        /></UTooltip></label>
        <USelectMenu
          :model-value="draftMode"
          value-key="value"
          :items="draftModeOptions"
          :search-input="false"
          @update:model-value="(value: string) => setDraftMode(value === 'ttt' || value === 'race' ? value : 'solo')"
        />
      </div>
      <!-- Race mode has no controls of its own by design (one field-calibrated
           constant), so the spare width carries the two things a rider has to
           know instead: what is being assumed, and what their W/kg still means.
           Bottom-aligned like every control in this row rather than centered -
           `self-center` measured itself against the tallest item (label plus
           control) and left the text floating above the select next to it. -->
      <p
        v-if="draftControlsOpen && draftMode === 'race'"
        class="flex-1 min-w-64 max-w-md self-end pb-2 text-xs text-muted"
      >
        Assumes typical mid-pack draft. Your W/kg still means your own race average.
      </p>
      <div
        v-if="draftControlsOpen && draftMode === 'ttt'"
        class="w-full sm:w-40"
      >
        <label class="block text-xs font-medium text-muted mb-1">Riders: {{ pendingRiders }} <UTooltip text="Team size in the rotation. Per-position draft stops improving past the 4th wheel, but team size keeps mattering: in a bigger team you spend a smaller share of the time on the front, which is where all the cost is."><UIcon
          name="i-lucide-info"
          class="size-3 text-muted align-text-bottom"
        /></UTooltip></label>
        <input
          v-model.number="pendingRiders"
          type="range"
          :min="TTT_MIN_RIDERS"
          :max="TTT_MAX_RIDERS"
          step="1"
          class="w-full cursor-pointer"
          aria-label="Number of riders in the paceline"
          @change="commitRiders"
        >
      </div>
      <div
        v-if="draftControlsOpen && draftMode === 'ttt' && props.hasLongClimb"
        class="w-full sm:w-64"
      >
        <label class="block text-xs font-medium text-muted mb-1">Team climb power: {{ pendingClimbWkg.toFixed(1) }} W/kg ({{ Math.round(pendingClimbWkg * weightKg) }} W) <UTooltip text="What the team averages on this route's long climbs, where a paceline breaks up and everyone rides their own pace. Only shown on routes that have one. Starts at your normal power and stays where you put it - changing the Power slider above never moves it."><UIcon
          name="i-lucide-info"
          class="size-3 text-muted align-text-bottom"
        /></UTooltip></label>
        <input
          v-model.number="pendingClimbWkg"
          type="range"
          :min="TTT_MIN_CLIMB_WKG"
          :max="TTT_MAX_CLIMB_WKG"
          step="0.1"
          class="w-full cursor-pointer"
          aria-label="Team average power on long climbs in watts per kilogram"
          @change="commitClimbWkg"
        >
      </div>
      <!-- `py-1.5 text-sm` is not a nudge - it is the same box `USelectMenu`'s
           own theme gives its trigger at the default `md` size. Two bottom-
           aligned flex items with identical vertical metrics put their text on
           the same line by construction, so this stays right if the row gains a
           control or the note wraps to two lines. `self-center` was the bug:
           in an `items-end` row it centres against the TALLEST item (a label
           plus its control, ~52px), leaving the link floating above every
           control's text line. A hand-tuned `pb-` value fixes the same-height
           case only, and is 2px out against this select. -->
      <a
        href="/profile"
        class="self-end py-1.5 text-sm text-primary underline"
        @click="openProfile"
      >
        (edit profile)
      </a>
    </div>
  </div>
</template>
