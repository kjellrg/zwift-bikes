<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'
import { BIKE_CATEGORY_FILTERS } from '#shared/types/catalog'
import { clampTttClimbWkg, TTT_MAX_CLIMB_WKG, TTT_MAX_RIDERS, TTT_MIN_CLIMB_WKG, TTT_MIN_RIDERS } from '#shared/utils/physics/draft'
import { POWER_W_RANGE, SPRINT_POWER_W_RANGE } from '#shared/utils/riderBounds'

// Shared by `ProfileModal.vue` (in-app UX) and `pages/profile.vue` (the
// deep-linkable copy). Keep this component free of modal-specific markup so
// both hosts can style their own heading/container - and free of
// `useRobotsRule`, which sets a site-global robots rule plus an X-Robots-Tag
// header and would mark whatever page the modal happens to be open on as
// noindex. That call stays on `pages/profile.vue`.

const { weightKg, heightCm, powerW, sprintPowerW, defaultUnownedLevel, draftMode, savedDraftMode, tttRiders, tttClimbWkg, load, setWeightKg, setHeightCm, setPowerW, setSprintPowerW, setDefaultUnownedLevel, setDraftMode, setTttRiders, setTttClimbWkg } = useRiderProfile()
// Bike category is a display filter rather than a rider attribute, so it
// lives in `usePreferences` alongside the other filters - but it's set here,
// because it's a default the rider picks once, not a per-route toggle.
// The two "Default ..." selects show the SAVED value, not the ref: the ref
// can hold a value a link supplied for the visit, and this page edits the
// default. Choosing here moves both, which also ends the link's override.
const { savedBikeCategory, showUpcomingRaces, load: loadPreferences, setBikeCategory, setShowUpcomingRaces } = usePreferences()
onMounted(() => {
  load()
  loadPreferences()
  pendingWeightKg.value = weightKg.value
  pendingHeightCm.value = heightCm.value
  pendingPowerW.value = powerW.value
  pendingSprintPowerW.value = sprintPowerW.value
  pendingRiders.value = tttRiders.value
  pendingClimbWkg.value = climbSliderWkg.value
})

// EVERY slider here commits on release (USlider's `change`), never per drag
// tick, and every one of them needs to: the modal opens over route, segment
// and event pages, where `useRecommendRequest` refetches from one watcher on
// the serialised query, and weight, height, power, draft mode, TTT riders
// and team climb pace are all part of it. A per-tick commit therefore writes
// localStorage and fires a recommend request per step crossed - dragging
// weight 75->100 kg costs 25 of each (issue #155). Same pending-ref shape as
// `RiderProfileControls.vue`, deliberately written out per control rather
// than abstracted: the climb-pace one below has its own seeding and
// undefined-guard rules that a shared helper would have to special-case.
const pendingWeightKg = ref(weightKg.value)
const pendingHeightCm = ref(heightCm.value)
const pendingPowerW = ref(powerW.value)
const pendingSprintPowerW = ref(sprintPowerW.value)
// Power is stored in watts, so committing weight leaves the wattage exactly
// where it is - only the derived W/kg readout moves.
const commitWeight = () => setWeightKg(pendingWeightKg.value)
const commitHeight = () => setHeightCm(pendingHeightCm.value)
const commitPower = () => setPowerW(pendingPowerW.value)
const commitSprintPower = () => setSprintPowerW(pendingSprintPowerW.value)
watch(weightKg, (value) => {
  pendingWeightKg.value = value
})
watch(heightCm, (value) => {
  pendingHeightCm.value = value
})
watch(powerW, (value) => {
  pendingPowerW.value = value
})
watch(sprintPowerW, (value) => {
  pendingSprintPowerW.value = value
})

const defaultUnownedLevelOptions = [0, 1, 2, 3, 4, 5].map(level => ({ label: level === 0 ? 'Stage 0 (stock, just unlocked)' : `Stage ${level}`, value: level }))
const bikeCategoryOptions: { label: string, value: BikeCategory | 'all' }[] = BIKE_CATEGORY_FILTERS
  .map(value => ({ label: value === 'all' ? 'All categories' : BIKE_CATEGORY_LABELS[value], value }))
// Where the climb slider sits. Once a team pace is stored that is what it
// shows; until then it tracks the rider's normal power, so the control starts
// at a sensible place without the profile actually claiming a value - which is
// what keeps "untouched" meaning "ride climbs at your normal power".
const climbSliderWkg = computed(() => tttClimbWkg.value ?? clampTttClimbWkg(powerW.value / weightKg.value) ?? TTT_MIN_CLIMB_WKG)

const pendingRiders = ref(tttRiders.value)
const commitRiders = () => setTttRiders(pendingRiders.value)
watch(tttRiders, (value) => {
  pendingRiders.value = value
})

// Watching the computed rather than `tttClimbWkg` keeps the untouched-state
// behaviour intact: while no pace is stored the slider tracks the rider's
// normal power, so moving the power slider in this same modal still carries
// it along. Once a pace is stored the computed is just that value.
const pendingClimbWkg = ref(climbSliderWkg.value)
const commitClimbWkg = () => setTttClimbWkg(pendingClimbWkg.value)
watch(climbSliderWkg, (value) => {
  pendingClimbWkg.value = value
})

// Derived from the committed value, not the pending one - the readout is a
// profile fact and should match what route pages will actually rank with.
const powerWkg = computed(() => powerW.value / weightKg.value)

// Every control here is named by its own `aria-label` - the names the browser
// journeys resolve it by - and every visible label is tied to the control it
// sits above, which it was not before. How depends on the control:
//
// - A `USelectMenu` puts its `id` on the trigger button, so `for`/`id` is a
//   real label association and clicking the label focuses the control.
// - A `USlider` puts its `id` on the track, not on the thumb that carries
//   `role="slider"`, so `for` would point at nothing labelable. Its label is
//   the live readout ("Rider weight: 82 kg"), which it forwards to the thumb
//   as `aria-describedby` - one of the few attributes it does forward. The
//   value is then announced with the control instead of being stranded text
//   beside it, and `aria-label` stays the name (passing `aria-labelledby`
//   would replace it with the readout, value and all).
const weightLabelId = useId()
const heightLabelId = useId()
const powerLabelId = useId()
const sprintPowerLabelId = useId()
const unownedStageId = useId()
const bikeCategoryId = useId()
const draftModeId = useId()
const tttRidersLabelId = useId()
const tttClimbLabelId = useId()
</script>

<template>
  <div class="space-y-6">
    <SiteNotice title="Stored on this device only">
      <p>Your profile is saved in this browser's local storage - there's no account system, so it won't follow you to another device or browser.</p>
    </SiteNotice>

    <div class="divide-y divide-default border-y border-default [&>*]:py-5">
      <div class="[&>*]:max-w-md">
        <label
          :id="weightLabelId"
          class="mb-1.5 block text-sm font-medium text-highlighted"
        >Rider weight: {{ pendingWeightKg }} kg</label>
        <USlider
          :model-value="pendingWeightKg"
          :min="40"
          :max="130"
          :step="1"
          aria-label="Rider weight in kilograms"
          :aria-describedby="weightLabelId"
          @update:model-value="(value: number | number[] | undefined) => { pendingWeightKg = sliderValue(value, pendingWeightKg) }"
          @change="commitWeight"
        />
        <div class="mt-1 flex justify-between text-xs text-muted">
          <span>40 kg</span><span>130 kg</span>
        </div>
        <p class="mt-1.5 text-sm text-toned">
          Weight drives gravity on climbs and, with height, the drag estimate. Changing it keeps your power in watts - only the derived W/kg moves.
        </p>
      </div>

      <div class="[&>*]:max-w-md">
        <label
          :id="heightLabelId"
          class="mb-1.5 block text-sm font-medium text-highlighted"
        >Rider height: {{ pendingHeightCm }} cm</label>
        <USlider
          :model-value="pendingHeightCm"
          :min="100"
          :max="220"
          :step="1"
          aria-label="Rider height in centimetres"
          :aria-describedby="heightLabelId"
          @update:model-value="(value: number | number[] | undefined) => { pendingHeightCm = sliderValue(value, pendingHeightCm) }"
          @change="commitHeight"
        />
        <div class="mt-1 flex justify-between text-xs text-muted">
          <span>100 cm</span><span>220 cm</span>
        </div>
        <p class="mt-1.5 text-sm text-toned">
          Height affects the aerodynamic drag estimate used by the physics model.
        </p>
      </div>

      <div class="[&>*]:max-w-md">
        <label
          :id="powerLabelId"
          class="mb-1.5 block text-sm font-medium text-highlighted"
        >Race power (FTP): {{ pendingPowerW }} W</label>
        <USlider
          :model-value="pendingPowerW"
          :min="POWER_W_RANGE.min"
          :max="POWER_W_RANGE.max"
          :step="POWER_W_RANGE.step"
          aria-label="Race power in watts"
          :aria-describedby="powerLabelId"
          @update:model-value="(value: number | number[] | undefined) => { pendingPowerW = sliderValue(value, pendingPowerW) }"
          @change="commitPower"
        />
        <div class="mt-1 flex justify-between text-xs text-muted">
          <span>{{ POWER_W_RANGE.min }} W</span><span>{{ POWER_W_RANGE.max }} W</span>
        </div>
        <p class="mt-1.5 text-sm text-toned">
          The sustained power recommendations are ranked at. It is the same stored value as the Power slider on route, segment and event pages - change it in either place and both move.
        </p>
      </div>

      <div class="[&>*]:max-w-md">
        <label
          :id="sprintPowerLabelId"
          class="mb-1.5 block text-sm font-medium text-highlighted"
        >Sprint power: {{ pendingSprintPowerW }} W</label>
        <USlider
          :model-value="pendingSprintPowerW"
          :min="SPRINT_POWER_W_RANGE.min"
          :max="SPRINT_POWER_W_RANGE.max"
          :step="SPRINT_POWER_W_RANGE.step"
          aria-label="Sprint power in watts"
          :aria-describedby="sprintPowerLabelId"
          @update:model-value="(value: number | number[] | undefined) => { pendingSprintPowerW = sliderValue(value, pendingSprintPowerW) }"
          @change="commitSprintPower"
        />
        <div class="mt-1 flex justify-between text-xs text-muted">
          <span>{{ SPRINT_POWER_W_RANGE.min }} W</span><span>{{ SPRINT_POWER_W_RANGE.max }} W</span>
        </div>
        <p class="mt-1.5 text-sm text-toned">
          What you can hold for a short all-out effort. Sprint segment pages rank with this instead of your race power - the two are stored separately, so cranking one never drags the other along.
        </p>
      </div>

      <div>
        <p class="text-sm font-medium text-highlighted">
          W/kg at race power
        </p>
        <p class="text-3xl font-semibold font-timing text-highlighted">
          {{ powerWkg.toFixed(2) }} W/kg
        </p>
        <p class="mt-1.5 text-sm text-toned">
          {{ powerW }} W ÷ {{ weightKg }} kg. Dialling power on a route page updates it here too.
        </p>
      </div>

      <div class="[&>*]:max-w-md">
        <label
          :for="unownedStageId"
          class="mb-1.5 block text-sm font-medium text-highlighted"
        >Assumed upgrade stage for bikes you don't own</label>
        <USelectMenu
          :id="unownedStageId"
          :model-value="defaultUnownedLevel"
          value-key="value"
          :items="defaultUnownedLevelOptions"
          :search-input="false"
          aria-label="Assumed upgrade stage for bikes you don't own"
          @update:model-value="(level: number) => setDefaultUnownedLevel(level)"
        />
        <p class="mt-1.5 text-sm text-toned">
          Your garage bikes use their actual upgrade stage; other bikes use this assumed stage.
        </p>
      </div>

      <div class="[&>*]:max-w-md">
        <label
          :for="bikeCategoryId"
          class="mb-1.5 block text-sm font-medium text-highlighted"
        >Default bike category</label>
        <USelectMenu
          :id="bikeCategoryId"
          :model-value="savedBikeCategory"
          value-key="value"
          :items="bikeCategoryOptions"
          :search-input="false"
          aria-label="Default bike category"
          @update:model-value="(value: BikeCategory | 'all') => setBikeCategory(value)"
        />
        <p class="mt-1.5 text-sm text-toned">
          Which category route and segment pages rank by. Standard is the default: TT bikes are usually fastest outright, but they're restricted in a lot of group rides and races. Whichever you pick, pages still tell you when a bike outside it would be faster.
        </p>
      </div>

      <div class="[&>*]:max-w-md">
        <div class="flex items-center gap-2">
          <USwitch
            :model-value="showUpcomingRaces"
            aria-label="Show upcoming races"
            @update:model-value="(value: boolean) => setShowUpcomingRaces(value)"
          />
          <span class="text-sm font-medium text-highlighted">Show upcoming races</span>
        </div>
        <p class="mt-1.5 text-sm text-toned">
          Surfaces the next race on the homepage and a "featured in upcoming races" note on route pages. The Events calendar itself stays in the menu either way.
        </p>
      </div>

      <div class="[&>*]:max-w-md">
        <label
          :for="draftModeId"
          class="mb-1.5 block text-sm font-medium text-highlighted"
        >Default draft mode</label>
        <USelectMenu
          :id="draftModeId"
          :model-value="savedDraftMode"
          value-key="value"
          :items="DRAFT_MODE_OPTIONS"
          :search-input="false"
          aria-label="Default draft mode"
          @update:model-value="(value: string) => setDraftMode(value === 'ttt' || value === 'race' ? value : 'solo')"
        />
        <p class="mt-1.5 text-sm text-toned">
          TTT (Team Time Trial) models a rotating paceline. Your W/kg still means your own average over a full rotation - you push well above it while pulling on the front and sit below it in the wheels - and the group moves at the speed that combined effort produces, which is a lot faster than riding alone at the same effort.
        </p>
        <p class="mt-1.5 text-sm text-toned">
          Race models a mass-start bunch, using one draft benefit measured from thirteen real race fields rather than a pack model - so it needs no extra settings. Your W/kg still means your own average for the race (average power, not normalised), and what you get is a typical mid-pack finish time, not a winning one.
        </p>
      </div>

      <div
        v-if="draftMode === 'ttt'"
        class="[&>*]:max-w-md"
      >
        <label
          :id="tttRidersLabelId"
          class="mb-1.5 block text-sm font-medium text-highlighted"
        >TTT riders: {{ pendingRiders }}</label>
        <USlider
          :model-value="pendingRiders"
          :min="TTT_MIN_RIDERS"
          :max="TTT_MAX_RIDERS"
          :step="1"
          aria-label="Riders in the paceline"
          :aria-describedby="tttRidersLabelId"
          @update:model-value="(value: number | number[] | undefined) => { pendingRiders = sliderValue(value, pendingRiders) }"
          @change="commitRiders"
        />
        <div class="mt-1 flex justify-between text-xs text-muted">
          <span>{{ TTT_MIN_RIDERS }} riders</span><span>{{ TTT_MAX_RIDERS }} riders</span>
        </div>
        <p class="mt-1.5 text-sm text-toned">
          How many riders rotate in the paceline. Per-position draft stops improving past the 4th wheel, but team size keeps mattering: in a bigger team you spend a smaller share of the time on the front, which is where all the cost is.
        </p>
      </div>

      <div
        v-if="draftMode === 'ttt'"
        class="[&>*]:max-w-md"
      >
        <label
          :id="tttClimbLabelId"
          class="mb-1.5 block text-sm font-medium text-highlighted"
        >Team climb pace: {{ pendingClimbWkg.toFixed(1) }} W/kg{{ tttClimbWkg === undefined ? ' (not set - your normal power)' : '' }}</label>
        <USlider
          :model-value="pendingClimbWkg"
          :min="TTT_MIN_CLIMB_WKG"
          :max="TTT_MAX_CLIMB_WKG"
          :step="0.1"
          aria-label="Team climb pace in watts per kilogram"
          :aria-describedby="tttClimbLabelId"
          @update:model-value="(value: number | number[] | undefined) => { pendingClimbWkg = sliderValue(value, pendingClimbWkg) }"
          @change="commitClimbWkg"
        />
        <div class="mt-1 flex justify-between text-xs text-muted">
          <span>{{ TTT_MIN_CLIMB_WKG }} W/kg</span><span>{{ TTT_MAX_CLIMB_WKG }} W/kg</span>
        </div>
        <p class="mt-1.5 text-sm text-toned">
          What the team averages on stretches slow enough that the rotation stops (roughly 2.5+ minutes below ~21 km/h), where drafting gives almost nothing. <template v-if="tttClimbWkg === undefined">
            Untouched, so climbs are ridden at your normal power - the slider starts there.
          </template><template v-else>
            Set independently of your FTP: changing your power above won't move it. <button
              type="button"
              class="text-primary underline"
              @click="setTttClimbWkg(undefined)"
            >
              Go back to using my normal power
            </button>.
          </template>
        </p>
      </div>
    </div>
  </div>
</template>
