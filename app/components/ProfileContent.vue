<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'
import { clampTttClimbWkg, TTT_MAX_CLIMB_WKG, TTT_MAX_RIDERS, TTT_MIN_CLIMB_WKG, TTT_MIN_RIDERS } from '#shared/utils/physics/draft'
import { POWER_W_RANGE, SPRINT_POWER_W_RANGE } from '#shared/utils/riderBounds'

// Shared by `ProfileModal.vue` (in-app UX) and `pages/profile.vue` (the
// deep-linkable copy). Keep this component free of modal-specific markup so
// both hosts can style their own heading/container - and free of
// `useRobotsRule`, which sets a site-global robots rule plus an X-Robots-Tag
// header and would mark whatever page the modal happens to be open on as
// noindex. That call stays on `pages/profile.vue`.

const { weightKg, heightCm, powerW, sprintPowerW, defaultUnownedLevel, draftMode, tttRiders, tttClimbWkg, load, setWeightKg, setHeightCm, setPowerW, setSprintPowerW, setDefaultUnownedLevel, setDraftMode, setTttRiders, setTttClimbWkg } = useRiderProfile()
// Bike category is a display filter rather than a rider attribute, so it
// lives in `usePreferences` alongside the other filters - but it's set here,
// because it's a default the rider picks once, not a per-route toggle.
const { bikeCategory, showUpcomingRaces, load: loadPreferences, setBikeCategory, setShowUpcomingRaces } = usePreferences()
onMounted(() => {
  load()
  loadPreferences()
  pendingPowerW.value = powerW.value
  pendingSprintPowerW.value = sprintPowerW.value
})

// Committed on release (USlider's `change`), not per drag tick: these
// sliders edit the same `powerW`/`sprintPowerW` the host pages' refetch
// watchers observe (the modal opens over route/segment/event pages), so
// per-tick commits would fire a recommend request per step - the storm
// RiderProfileControls' pending refs exist to prevent.
const pendingPowerW = ref(powerW.value)
const pendingSprintPowerW = ref(sprintPowerW.value)
const commitPower = () => setPowerW(pendingPowerW.value)
const commitSprintPower = () => setSprintPowerW(pendingSprintPowerW.value)
watch(powerW, (value) => {
  pendingPowerW.value = value
})
watch(sprintPowerW, (value) => {
  pendingSprintPowerW.value = value
})

const defaultUnownedLevelOptions = [0, 1, 2, 3, 4, 5].map(level => ({ label: level === 0 ? 'Level 0 (stock, just unlocked)' : `Level ${level}`, value: level }))
const draftModeOptions = [{ label: 'Solo (no draft)', value: 'solo' }, { label: 'TTT (paceline)', value: 'ttt' }, { label: 'Race (pack draft)', value: 'race' }]
const bikeCategoryOptions: { label: string, value: BikeCategory | 'all' }[] = [
  { label: 'All categories', value: 'all' }, { label: BIKE_CATEGORY_LABELS.standard, value: 'standard' },
  { label: BIKE_CATEGORY_LABELS.tt, value: 'tt' }, { label: BIKE_CATEGORY_LABELS.gravel, value: 'gravel' },
  { label: BIKE_CATEGORY_LABELS.funbike, value: 'funbike' }, { label: BIKE_CATEGORY_LABELS.handbike, value: 'handbike' }
]
// Where the climb slider sits. Once a team pace is stored that is what it
// shows; until then it tracks the rider's normal power, so the control starts
// at a sensible place without the profile actually claiming a value - which is
// what keeps "untouched" meaning "ride climbs at your normal power".
const climbSliderWkg = computed(() => tttClimbWkg.value ?? clampTttClimbWkg(powerW.value / weightKg.value) ?? TTT_MIN_CLIMB_WKG)

// Derived from the committed value, not the pending one - the readout is a
// profile fact and should match what route pages will actually rank with.
const powerWkg = computed(() => powerW.value / weightKg.value)
</script>

<template>
  <div class="space-y-8">
    <p class="text-muted mt-1">
      Set your weight, height and FTP so route recommendations can estimate finish times using the dynamic physics model. Your profile is stored locally in this browser.
    </p>

    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="Stored on this device only"
      description="Your profile is saved in this browser's local storage - there's no account system, so it won't follow you to another device or browser."
    />

    <div class="rounded-lg border border-default p-4 space-y-6">
      <div class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">Rider weight: {{ weightKg }} kg</label>
        <USlider
          :model-value="weightKg"
          :min="40"
          :max="130"
          :step="1"
          @update:model-value="(value: number | undefined) => setWeightKg(value ?? weightKg)"
        />
        <div class="flex justify-between text-xs text-muted mt-1">
          <span>40 kg</span><span>130 kg</span>
        </div>
        <p class="text-sm text-muted mt-1">
          Weight drives gravity on climbs and, with height, the drag estimate. Changing it keeps your power in watts - only the derived W/kg moves.
        </p>
      </div>

      <div class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">Rider height: {{ heightCm }} cm</label>
        <USlider
          :model-value="heightCm"
          :min="100"
          :max="220"
          :step="1"
          @update:model-value="(value: number | undefined) => setHeightCm(value ?? heightCm)"
        />
        <div class="flex justify-between text-xs text-muted mt-1">
          <span>100 cm</span><span>220 cm</span>
        </div>
        <p class="text-sm text-muted mt-1">
          Height affects the aerodynamic drag estimate used by the physics model.
        </p>
      </div>

      <div class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">Race power (FTP): {{ pendingPowerW }} W</label>
        <USlider
          :model-value="pendingPowerW"
          :min="POWER_W_RANGE.min"
          :max="POWER_W_RANGE.max"
          :step="POWER_W_RANGE.step"
          aria-label="Race power in watts"
          @update:model-value="(value: number | undefined) => { pendingPowerW = value ?? pendingPowerW }"
          @change="commitPower"
        />
        <div class="flex justify-between text-xs text-muted mt-1">
          <span>{{ POWER_W_RANGE.min }} W</span><span>{{ POWER_W_RANGE.max }} W</span>
        </div>
        <p class="text-sm text-muted mt-1">
          The sustained power recommendations are ranked at. It is the same stored value as the Power slider on route, segment and event pages - change it in either place and both move.
        </p>
      </div>

      <div class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">Sprint power: {{ pendingSprintPowerW }} W</label>
        <USlider
          :model-value="pendingSprintPowerW"
          :min="SPRINT_POWER_W_RANGE.min"
          :max="SPRINT_POWER_W_RANGE.max"
          :step="SPRINT_POWER_W_RANGE.step"
          aria-label="Sprint power in watts"
          @update:model-value="(value: number | undefined) => { pendingSprintPowerW = value ?? pendingSprintPowerW }"
          @change="commitSprintPower"
        />
        <div class="flex justify-between text-xs text-muted mt-1">
          <span>{{ SPRINT_POWER_W_RANGE.min }} W</span><span>{{ SPRINT_POWER_W_RANGE.max }} W</span>
        </div>
        <p class="text-sm text-muted mt-1">
          What you can hold for a short all-out effort. Sprint segment pages rank with this instead of your race power - the two are stored separately, so cranking one never drags the other along.
        </p>
      </div>

      <div>
        <p class="text-xs font-medium text-muted uppercase tracking-wide">
          W/kg at race power
        </p>
        <p class="text-2xl font-bold text-primary">
          {{ powerWkg.toFixed(2) }} W/kg
        </p>
        <p class="text-sm text-muted mt-1">
          {{ powerW }} W ÷ {{ weightKg }} kg. Dialling power on a route page updates it here too.
        </p>
      </div>

      <div class="max-w-xs">
        <label class="block text-xs font-medium text-muted mb-1">Assumed upgrade level for bikes you don't own</label>
        <USelectMenu
          :model-value="defaultUnownedLevel"
          value-key="value"
          :items="defaultUnownedLevelOptions"
          :search-input="false"
          @update:model-value="(level: number) => setDefaultUnownedLevel(level)"
        />
        <p class="text-sm text-muted mt-1">
          Your garage bikes use their actual upgrade level; other bikes use this assumed level.
        </p>
      </div>

      <div class="max-w-xs">
        <label class="block text-xs font-medium text-muted mb-1">Default bike category</label>
        <USelectMenu
          :model-value="bikeCategory"
          value-key="value"
          :items="bikeCategoryOptions"
          :search-input="false"
          @update:model-value="(value: BikeCategory | 'all') => setBikeCategory(value)"
        />
        <p class="text-sm text-muted mt-1">
          Which category route and segment pages rank by. Standard is the default: TT bikes are usually fastest outright, but they're restricted in a lot of group rides and races. Whichever you pick, pages still tell you when a bike outside it would be faster.
        </p>
      </div>

      <div class="max-w-md">
        <div class="flex items-center gap-2">
          <USwitch
            :model-value="showUpcomingRaces"
            aria-label="Show upcoming races"
            @update:model-value="(value: boolean) => setShowUpcomingRaces(value)"
          />
          <span class="text-sm">Show upcoming races</span>
        </div>
        <p class="text-sm text-muted mt-1">
          Surfaces the next race on the homepage and a "featured in upcoming races" note on route pages. The Events calendar itself stays in the menu either way.
        </p>
      </div>

      <div class="max-w-xs">
        <label class="block text-xs font-medium text-muted mb-1">Default draft mode</label>
        <USelectMenu
          :model-value="draftMode"
          value-key="value"
          :items="draftModeOptions"
          :search-input="false"
          @update:model-value="(value: string) => setDraftMode(value === 'ttt' || value === 'race' ? value : 'solo')"
        />
        <p class="text-sm text-muted mt-1">
          TTT (Team Time Trial) models a rotating paceline. Your W/kg still means your own average over a full rotation - you push well above it while pulling on the front and sit below it in the wheels - and the group moves at the speed that combined effort produces, which is a lot faster than riding alone at the same effort.
        </p>
        <p class="text-sm text-muted mt-1">
          Race models a mass-start bunch, using one draft benefit measured from thirteen real race fields rather than a pack model - so it needs no extra settings. Your W/kg still means your own average for the race (average power, not normalised), and what you get is a typical mid-pack finish time, not a winning one.
        </p>
      </div>

      <div
        v-if="draftMode === 'ttt'"
        class="max-w-md"
      >
        <label class="block text-xs font-medium text-muted mb-1">TTT riders: {{ tttRiders }}</label>
        <USlider
          :model-value="tttRiders"
          :min="TTT_MIN_RIDERS"
          :max="TTT_MAX_RIDERS"
          :step="1"
          @update:model-value="(value: number | undefined) => setTttRiders(value ?? tttRiders)"
        />
        <div class="flex justify-between text-xs text-muted mt-1">
          <span>{{ TTT_MIN_RIDERS }} riders</span><span>{{ TTT_MAX_RIDERS }} riders</span>
        </div>
        <p class="text-sm text-muted mt-1">
          How many riders rotate in the paceline. Per-position draft stops improving past the 4th wheel, but team size keeps mattering: in a bigger team you spend a smaller share of the time on the front, which is where all the cost is.
        </p>
      </div>

      <div
        v-if="draftMode === 'ttt'"
        class="max-w-md"
      >
        <label class="block text-xs font-medium text-muted mb-1">Team climb pace: {{ tttClimbWkg === undefined ? `not set (${climbSliderWkg.toFixed(1)} W/kg, your normal power)` : `${tttClimbWkg.toFixed(1)} W/kg` }}</label>
        <USlider
          :model-value="climbSliderWkg"
          :min="TTT_MIN_CLIMB_WKG"
          :max="TTT_MAX_CLIMB_WKG"
          :step="0.1"
          @update:model-value="(value: number | undefined) => setTttClimbWkg(value ?? climbSliderWkg)"
        />
        <div class="flex justify-between text-xs text-muted mt-1">
          <span>{{ TTT_MIN_CLIMB_WKG }} W/kg</span><span>{{ TTT_MAX_CLIMB_WKG }} W/kg</span>
        </div>
        <p class="text-sm text-muted mt-1">
          What the team averages on stretches slow enough that the rotation stops (roughly 2.5+ minutes below ~21 km/h), where drafting gives almost nothing. <template v-if="tttClimbWkg === undefined">
            Untouched, so climbs are ridden at your normal power - the slider starts there.
          </template><template v-else>
            Set independently of your FTP: changing your power above won't move it. <ULink
              class="text-primary underline cursor-pointer"
              @click="setTttClimbWkg(undefined)"
            >Go back to using my normal power</ULink>.
          </template>
        </p>
      </div>
    </div>
  </div>
</template>
