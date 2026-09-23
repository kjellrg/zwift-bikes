<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'
import { BIKE_CATEGORY_FILTERS } from '#shared/types/catalog'
import { clampTttClimbWkg, TTT_MAX_CLIMB_WKG, TTT_MAX_RIDERS, TTT_MIN_CLIMB_WKG, TTT_MIN_RIDERS } from '#shared/utils/physics/draft'
import { POWER_W_RANGE, SPRINT_POWER_W_RANGE } from '#shared/utils/riderBounds'
import type { AppliedRiderInputs } from '../utils/recommendRequest'

/**
 * The Rider card (see `CONTEXT.md`): the Applied rider beside the
 * Recommendation on every ranking page, and every lever that moves a time.
 *
 * Two readings of one rider, on purpose. The summary line at the top (the
 * `Rider` group) is the APPLIED rider - what the times on screen were
 * computed for - and it lags a moved lever until the response lands, under
 * the card's own "updating" line, so a time is never explained by inputs it
 * was not computed from. The levers below are live: each writes the stored
 * profile through `useRiderProfile`'s setters the moment it is released (a
 * slider commits on `change`, never per drag tick), so this card, the
 * profile Overlay and the profile page edit one rider and there is nothing
 * to save separately. `useRecommendRequest` refetches from its one watcher
 * on the serialised query, so the card needs no wiring to the page.
 *
 * What the page knows and the rider does not is a prop: whether this ride
 * is ridden at sprint power, whether its format fixes the draft or bars TT
 * frames (and why), and whether its lap count is the rider's to pick or the
 * Ride's. A fixed value is shown as fixed, with the reason, rather than as a
 * control that would change nothing.
 *
 * `load()` runs here, in the child's `onMounted` - which fires before the
 * page's - immediately followed by the pending-slider seeding, preserving
 * the load-then-seed order the old slider box kept: a stored profile with a
 * different power but no committed team climb pace still seeds the climb
 * slider from the loaded power, not the default.
 */
const props = withDefaults(defineProps<{
  /** The rider the results on screen were ranked for - `useRecommendRequest().appliedInputs`. */
  rider: AppliedRiderInputs
  /** Whether the times on screen are being recomputed. */
  refreshing: boolean
  /** Whether the ride has a climb long enough for the team climb pace to matter - see `detectLongClimbBlocks`. */
  hasLongClimb?: boolean
  /** Whether the power lever edits the rider's separate sprint power, as on a sprint segment. */
  sprintPower?: boolean
  /** Why the ride is ridden with no draft, when its format says so; the draft is then fixed at solo. */
  draftLocked?: string
  /** Why TT frames are barred on this ride, when they are; the category lever then offers everything else. */
  ttBarred?: string
  /** The lap counts the rider may pick, on a route; `v-model:laps` holds the pick. */
  lapOptions?: { label: string, value: number }[]
  /** The lap count the Ride fixes and why - a race group's laps, a segment timed once. */
  fixedLaps?: { label: string, reason: string }
  /** The lap count the times on screen were computed for - `appliedRide.laps`; absent on a segment, ridden once. */
  appliedLaps?: number
}>(), { hasLongClimb: true, sprintPower: false })

const laps = defineModel<number>('laps')

const {
  weightKg, heightCm, powerW, sprintPowerW, draftMode, draftModeFromLink, tttRiders, tttClimbWkg, hasStoredProfile,
  load: loadRiderProfile, setWeightKg, setPowerW, setSprintPowerW, setHeightCm, setDraftMode, restoreDraftMode, setTttRiders, setTttClimbWkg
} = useRiderProfile()
const { bikeCategory, categoryFromLink, load: loadPreferences, setBikeCategory, restoreBikeCategory } = usePreferences()
const { openProfile } = useOverlays()

const activePowerW = computed(() => props.sprintPower ? sprintPowerW.value : powerW.value)
const powerRange = computed(() => props.sprintPower ? SPRINT_POWER_W_RANGE : POWER_W_RANGE)

const pendingWeightKg = ref(weightKg.value)
const pendingHeightCm = ref(heightCm.value)
const pendingPowerW = ref(activePowerW.value)
// Seeded from the rider's normal power (in W/kg, and always `powerW` - a
// sprint page's wattage is the wrong quantity for a sustained climb), then
// left alone: moving the power lever never drags the team's climb pace with
// it. Until it is committed the profile keeps it `undefined` and the query
// omits it, which is what makes "not set" mean "ride the climbs at your
// normal power". Clamped into the slider's range so a strong rider's thumb
// does not jump on first touch.
const seedClimbWkg = () => tttClimbWkg.value ?? clampTttClimbWkg(powerW.value / weightKg.value) ?? TTT_MIN_CLIMB_WKG
const pendingClimbWkg = ref(seedClimbWkg())
const pendingRiders = ref(tttRiders.value)

onMounted(() => {
  loadRiderProfile()
  loadPreferences()
  pendingWeightKg.value = weightKg.value
  pendingHeightCm.value = heightCm.value
  pendingPowerW.value = activePowerW.value
  pendingRiders.value = tttRiders.value
  pendingClimbWkg.value = seedClimbWkg()
})

// Power is stored in watts, so committing weight leaves the wattage where it
// is - only the derived W/kg readout moves.
const commitWeight = () => setWeightKg(pendingWeightKg.value)
const commitHeight = () => setHeightCm(pendingHeightCm.value)
const commitPower = () => props.sprintPower ? setSprintPowerW(pendingPowerW.value) : setPowerW(pendingPowerW.value)
const commitClimbWkg = () => setTttClimbWkg(pendingClimbWkg.value)
const commitRiders = () => setTttRiders(pendingRiders.value)
watch(weightKg, value => pendingWeightKg.value = value)
watch(heightCm, value => pendingHeightCm.value = value)
watch(activePowerW, value => pendingPowerW.value = value)
watch(tttRiders, value => pendingRiders.value = value)
watch(tttClimbWkg, (value) => {
  if (value !== undefined) pendingClimbWkg.value = value
})

// What the draft lever shows: solo whatever is stored when the ride has no
// draft, which is what the ranking is computed at - the stored mode is left
// alone for every other page.
const liveDraftMode = computed(() => props.draftLocked ? 'solo' : draftMode.value)

// The category lever lists every value the ride can honour: a ride that bars
// TT frames drops the option rather than offering a category the ranking
// would refuse, and a stored `tt` reads as "All categories" here without
// being written back - the same substitution `rideCategory` makes on the
// request side.
const categoryOptions = computed(() => BIKE_CATEGORY_FILTERS
  .filter(value => !(props.ttBarred && value === 'tt'))
  .map(value => ({ label: value === 'all' ? 'All categories' : BIKE_CATEGORY_LABELS[value], value })))
const displayCategory = computed(() => props.ttBarred && bikeCategory.value === 'tt' ? 'all' : bikeCategory.value)

const appliedLine = computed(() => {
  const rider = props.rider
  return {
    body: `${rider.weightKg} kg · ${rider.heightCm} cm`,
    power: `${rider.powerW} W`,
    wkg: `${(rider.powerW / rider.weightKg).toFixed(2)} W/kg${props.sprintPower ? ', sprint' : ''}`,
    draft: DRAFT_MODE_LABELS[rider.draftMode],
    laps: props.appliedLaps === undefined ? 'once' : `${props.appliedLaps} lap${props.appliedLaps === 1 ? '' : 's'}`,
    category: rider.category === 'all' ? 'All categories' : BIKE_CATEGORY_LABELS[rider.category]
  }
})

const ids = { weight: useId(), height: useId(), power: useId(), draft: useId(), laps: useId(), category: useId() }
</script>

<template>
  <aside
    aria-labelledby="rider-card-heading"
    class="min-w-0 rounded-xl border border-default bg-elevated p-5 shadow-card"
  >
    <div class="flex items-baseline justify-between gap-3">
      <h2
        id="rider-card-heading"
        class="text-sm font-semibold text-muted"
      >
        Timed for this rider
      </h2>
      <!-- A real href for deep links and modifier-clicks; a plain click
           opens the profile Overlay over the page - see `useOverlays`. -->
      <a
        href="/profile"
        aria-haspopup="dialog"
        class="text-sm text-primary hover:underline"
        @click="openProfile"
      >{{ hasStoredProfile ? 'Edit profile' : 'Set your profile' }}</a>
    </div>

    <!-- The Applied rider: what the times on screen were computed for. -->
    <p
      role="group"
      aria-label="Rider"
      class="mt-2 flex flex-wrap items-center gap-x-1.5 text-md text-highlighted"
    >
      <span>{{ appliedLine.body }}</span><span aria-hidden="true">·</span>
      <span>{{ appliedLine.power }} <span class="text-sm text-muted">({{ appliedLine.wkg }})</span></span><span aria-hidden="true">·</span>
      <span class="inline-flex items-center gap-1">{{ appliedLine.draft }}<FromLinkMarker
        v-if="draftModeFromLink && !draftLocked"
        restore-label="Restore my saved draft mode"
        @restore="restoreDraftMode"
      /></span><span aria-hidden="true">·</span>
      <span>{{ appliedLine.laps }}</span><span aria-hidden="true">·</span>
      <span>{{ appliedLine.category }}</span>
    </p>
    <!-- Until a profile is saved every time on the page is the default
         rider's - said in the one status colour for it, or a first visit
         reads as a prediction about the visitor. -->
    <p
      v-if="!hasStoredProfile"
      class="mt-1.5 text-sm text-warning"
    >
      Default rider. Set yours and every time on the site updates.
    </p>

    <div class="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
      <div>
        <label
          :for="ids.weight"
          class="block text-xs text-muted"
        >Weight</label>
        <p class="text-xl font-semibold font-heading text-highlighted">
          {{ pendingWeightKg }} <span class="text-sm font-normal text-muted">kg</span>
        </p>
        <USlider
          :id="ids.weight"
          :model-value="pendingWeightKg"
          :min="40"
          :max="130"
          :step="1"
          size="sm"
          class="mt-2"
          aria-label="Rider weight in kilograms"
          @update:model-value="(value: number | number[] | undefined) => { pendingWeightKg = sliderValue(value, pendingWeightKg) }"
          @change="commitWeight"
        />
      </div>
      <div>
        <label
          :for="ids.power"
          class="block text-xs text-muted"
        >{{ sprintPower ? 'Sprint power' : 'Sustained power' }}</label>
        <p class="text-xl font-semibold font-heading text-highlighted">
          {{ pendingPowerW }} <span class="text-sm font-normal text-muted">W · {{ (pendingPowerW / pendingWeightKg).toFixed(2) }} W/kg</span>
        </p>
        <USlider
          :id="ids.power"
          :model-value="pendingPowerW"
          :min="powerRange.min"
          :max="powerRange.max"
          :step="powerRange.step"
          size="sm"
          class="mt-2"
          aria-label="Rider power in watts"
          @update:model-value="(value: number | number[] | undefined) => { pendingPowerW = sliderValue(value, pendingPowerW) }"
          @change="commitPower"
        />
      </div>
      <div>
        <label
          :for="ids.height"
          class="block text-xs text-muted"
        >Height</label>
        <p class="text-xl font-semibold font-heading text-highlighted">
          {{ pendingHeightCm }} <span class="text-sm font-normal text-muted">cm</span>
        </p>
        <USlider
          :id="ids.height"
          :model-value="pendingHeightCm"
          :min="100"
          :max="220"
          :step="1"
          size="sm"
          class="mt-2"
          aria-label="Rider height"
          @update:model-value="(value: number | number[] | undefined) => { pendingHeightCm = sliderValue(value, pendingHeightCm) }"
          @change="commitHeight"
        />
      </div>
      <div>
        <div class="flex items-center gap-1.5">
          <label
            :for="ids.draft"
            class="text-xs text-muted"
          >Draft</label>
          <FromLinkMarker
            v-if="draftModeFromLink && !draftLocked"
            restore-label="Restore my saved draft mode"
            @restore="restoreDraftMode"
          />
        </div>
        <p
          v-if="draftLocked"
          class="mt-1 text-md text-highlighted"
        >
          Solo <span class="block text-xs text-muted">{{ draftLocked }}</span>
        </p>
        <USelectMenu
          v-else
          :id="ids.draft"
          :model-value="liveDraftMode"
          value-key="value"
          :items="DRAFT_MODE_OPTIONS"
          :search-input="false"
          class="mt-1 w-full"
          aria-label="Draft mode"
          @update:model-value="(value: string) => setDraftMode(value === 'ttt' || value === 'race' ? value : 'solo')"
        />
      </div>
      <!-- Laps and Frames take the card's whole width on a phone: half of
           it is narrower than "Standard (Road)" and the select's chevron. -->
      <div class="max-sm:col-span-2">
        <label
          :for="ids.laps"
          class="block text-xs text-muted"
        >Laps</label>
        <p
          v-if="fixedLaps"
          class="mt-1 text-md text-highlighted"
        >
          {{ fixedLaps.label }} <span class="block text-xs text-muted">{{ fixedLaps.reason }}</span>
        </p>
        <USelectMenu
          v-else-if="lapOptions && lapOptions.length > 1"
          :id="ids.laps"
          v-model="laps"
          value-key="value"
          :items="lapOptions"
          :search-input="false"
          class="mt-1 w-full"
          aria-label="Laps"
        />
        <p
          v-else
          class="mt-1 text-md text-highlighted"
        >
          1 lap <span class="block text-xs text-muted">This route is ridden once</span>
        </p>
      </div>
      <div class="max-sm:col-span-2">
        <div class="flex items-center gap-1.5">
          <label
            :for="ids.category"
            class="text-xs text-muted"
          >Frames</label>
          <FromLinkMarker
            v-if="categoryFromLink"
            restore-label="Restore my saved category"
            @restore="restoreBikeCategory"
          />
        </div>
        <USelect
          :id="ids.category"
          :model-value="displayCategory"
          :items="categoryOptions"
          value-key="value"
          class="mt-1 w-full"
          aria-label="Bike category"
          @update:model-value="(value: BikeCategory | 'all') => setBikeCategory(value)"
        />
        <p
          v-if="ttBarred"
          class="mt-1 text-xs text-muted"
        >
          {{ ttBarred }}
        </p>
      </div>
    </div>

    <!-- The paceline's own levers, only under TTT drafting; race drafting
         has none by design (one field-calibrated constant), so it gets the
         two things a rider has to know instead. -->
    <div
      v-if="liveDraftMode === 'ttt'"
      class="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-default pt-4"
    >
      <div>
        <p class="text-xs text-muted">
          Riders in the paceline
        </p>
        <p class="text-xl font-semibold font-heading text-highlighted">
          {{ pendingRiders }}
        </p>
        <USlider
          :model-value="pendingRiders"
          :min="TTT_MIN_RIDERS"
          :max="TTT_MAX_RIDERS"
          :step="1"
          size="sm"
          class="mt-2"
          aria-label="Number of riders in the paceline"
          @update:model-value="(value: number | number[] | undefined) => { pendingRiders = sliderValue(value, pendingRiders) }"
          @change="commitRiders"
        />
      </div>
      <div v-if="hasLongClimb">
        <p class="text-xs text-muted">
          Team pace on long climbs
        </p>
        <p class="text-xl font-semibold font-heading text-highlighted">
          {{ pendingClimbWkg.toFixed(1) }} <span class="text-sm font-normal text-muted">W/kg · {{ Math.round(pendingClimbWkg * pendingWeightKg) }} W</span>
        </p>
        <USlider
          :model-value="pendingClimbWkg"
          :min="TTT_MIN_CLIMB_WKG"
          :max="TTT_MAX_CLIMB_WKG"
          :step="0.1"
          size="sm"
          class="mt-2"
          aria-label="Team average power on long climbs in watts per kilogram"
          @update:model-value="(value: number | number[] | undefined) => { pendingClimbWkg = sliderValue(value, pendingClimbWkg) }"
          @change="commitClimbWkg"
        />
      </div>
      <p class="col-span-2 text-xs text-muted">
        Your power stays your average over a full rotation; the team moves at the speed that combined effort produces.
      </p>
    </div>
    <p
      v-else-if="liveDraftMode === 'race'"
      class="mt-4 border-t border-default pt-4 text-xs text-muted"
    >
      Assumes a typical mid-pack draft. Your W/kg is still your own race average.
    </p>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span
        class="inline-flex items-center gap-1.5"
        role="status"
      >
        <UIcon
          v-if="refreshing"
          name="i-lucide-loader-circle"
          class="size-3.5 animate-spin"
        />
        <span
          v-else
          class="size-1.5 rounded-full bg-primary"
          aria-hidden="true"
        />
        {{ refreshing ? 'Updating the times…' : 'Times update when you release a lever' }}
      </span>
      <span>Stored in your browser only</span>
    </div>
  </aside>
</template>
