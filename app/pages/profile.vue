<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'
import { clampTttClimbWkg, TTT_MAX_CLIMB_WKG, TTT_MAX_RIDERS, TTT_MIN_CLIMB_WKG, TTT_MIN_RIDERS } from '#shared/utils/physics/draft'

const { weightKg, heightCm, ftpWatts, wkg, defaultUnownedLevel, draftMode, tttRiders, tttClimbWkg, load, setWeightKg, setHeightCm, setFtpWatts, setDefaultUnownedLevel, setDraftMode, setTttRiders, setTttClimbWkg } = useRiderProfile()
// Bike category is a display filter rather than a rider attribute, so it
// lives in `usePreferences` alongside the other filters - but it's set here,
// because it's a default the rider picks once, not a per-route toggle.
const { bikeCategory, load: loadPreferences, setBikeCategory } = usePreferences()
onMounted(() => { load(); loadPreferences() })

// Everything on this page renders from localStorage, so a crawler only ever
// sees an empty shell - thin content with nothing to rank for. Keep it out
// of the index, but still follow its links out. `useRobotsRule` (from
// @nuxtjs/robots) rather than `useSeoMeta`, so this owns the single robots
// meta tag the module manages instead of racing it, and sets the matching
// X-Robots-Tag header too.
useRobotsRule('noindex, follow')
const defaultUnownedLevelOptions = [0, 1, 2, 3, 4, 5].map(level => ({ label: level === 0 ? 'Level 0 (stock, just unlocked)' : `Level ${level}`, value: level }))
const draftModeOptions = [{ label: 'Solo (no draft)', value: 'solo' }, { label: 'TTT (paceline)', value: 'ttt' }]
const bikeCategoryOptions: { label: string, value: BikeCategory | 'all' }[] = [
  { label: 'All categories', value: 'all' }, { label: BIKE_CATEGORY_LABELS.standard, value: 'standard' },
  { label: BIKE_CATEGORY_LABELS.tt, value: 'tt' }, { label: BIKE_CATEGORY_LABELS.gravel, value: 'gravel' },
  { label: BIKE_CATEGORY_LABELS.funbike, value: 'funbike' }, { label: BIKE_CATEGORY_LABELS.handbike, value: 'handbike' }
]
// Where the climb slider sits. Once a team pace is stored that is what it
// shows; until then it tracks the rider's normal power, so the control starts
// at a sensible place without the profile actually claiming a value - which is
// what keeps "untouched" meaning "ride climbs at your normal power".
const climbSliderWkg = computed(() => tttClimbWkg.value ?? clampTttClimbWkg(wkg.value) ?? TTT_MIN_CLIMB_WKG)
</script>

<template>
  <UContainer class="py-10 space-y-8">
    <div>
      <h1 class="text-3xl font-bold text-highlighted">My Profile</h1>
      <p class="text-muted mt-1">Set your weight, height and FTP so route recommendations can estimate finish times using the dynamic physics model. Your profile is stored locally in this browser.</p>
    </div>

    <UAlert color="neutral" variant="subtle" icon="i-lucide-info" title="Stored on this device only" description="Your profile is saved in this browser's local storage - there's no account system, so it won't follow you to another device or browser." />

    <div class="rounded-lg border border-default p-4 space-y-6">
      <div class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">Rider weight: {{ weightKg }} kg</label>
        <USlider :model-value="weightKg" :min="40" :max="130" :step="1" @update:model-value="(value: number | undefined) => setWeightKg(value ?? weightKg)" />
        <div class="flex justify-between text-xs text-muted mt-1"><span>40 kg</span><span>130 kg</span></div>
        <p class="text-sm text-muted mt-1">Weight drives gravity on climbs and, with height, the drag estimate. Changing it keeps your FTP and re-derives W/kg.</p>
      </div>

      <div class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">Rider height: {{ heightCm }} cm</label>
        <USlider :model-value="heightCm" :min="100" :max="220" :step="1" @update:model-value="(value: number | undefined) => setHeightCm(value ?? heightCm)" />
        <div class="flex justify-between text-xs text-muted mt-1"><span>100 cm</span><span>220 cm</span></div>
        <p class="text-sm text-muted mt-1">Height affects the aerodynamic drag estimate used by the physics model.</p>
      </div>

      <div class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">FTP: {{ ftpWatts }} W</label>
        <USlider :model-value="ftpWatts" :min="50" :max="400" :step="1" @update:model-value="(value: number | undefined) => setFtpWatts(value ?? ftpWatts)" />
      </div>

      <div>
        <p class="text-xs font-medium text-muted uppercase tracking-wide">W/kg at FTP</p>
        <p class="text-2xl font-bold text-primary">{{ wkg.toFixed(2) }} W/kg</p>
        <p class="text-sm text-muted mt-1">{{ ftpWatts }} W ÷ {{ weightKg }} kg. You can still dial power up or down per route.</p>
      </div>

      <div class="max-w-xs">
        <label class="block text-xs font-medium text-muted mb-1">Assumed upgrade level for bikes you don't own</label>
        <USelectMenu :model-value="defaultUnownedLevel" value-key="value" :items="defaultUnownedLevelOptions" :search-input="false" @update:model-value="(level: number) => setDefaultUnownedLevel(level)" />
        <p class="text-sm text-muted mt-1">Your garage bikes use their actual upgrade level; other bikes use this assumed level.</p>
      </div>

      <div class="max-w-xs">
        <label class="block text-xs font-medium text-muted mb-1">Default bike category</label>
        <USelectMenu :model-value="bikeCategory" value-key="value" :items="bikeCategoryOptions" :search-input="false" @update:model-value="(value: BikeCategory | 'all') => setBikeCategory(value)" />
        <p class="text-sm text-muted mt-1">Which category route and segment pages rank by. Standard is the default: TT bikes are usually fastest outright, but they're restricted in a lot of group rides and races. Whichever you pick, pages still tell you when a bike outside it would be faster.</p>
      </div>

      <div class="max-w-xs">
        <label class="block text-xs font-medium text-muted mb-1">Default draft mode</label>
        <USelectMenu :model-value="draftMode" value-key="value" :items="draftModeOptions" :search-input="false" @update:model-value="(value: string) => setDraftMode(value === 'ttt' ? 'ttt' : 'solo')" />
        <p class="text-sm text-muted mt-1">TTT (Team Time Trial) models a rotating paceline. Your W/kg still means your own average over a full rotation - you push well above it while pulling on the front and sit below it in the wheels - and the group moves at the speed that combined effort produces, which is a lot faster than riding alone at the same effort.</p>
      </div>

      <div v-if="draftMode === 'ttt'" class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">TTT riders: {{ tttRiders }}</label>
        <USlider :model-value="tttRiders" :min="TTT_MIN_RIDERS" :max="TTT_MAX_RIDERS" :step="1" @update:model-value="(value: number | undefined) => setTttRiders(value ?? tttRiders)" />
        <div class="flex justify-between text-xs text-muted mt-1"><span>{{ TTT_MIN_RIDERS }} riders</span><span>{{ TTT_MAX_RIDERS }} riders</span></div>
        <p class="text-sm text-muted mt-1">How many riders rotate in the paceline. Per-position draft stops improving past the 4th wheel, but team size keeps mattering: in a bigger team you spend a smaller share of the time on the front, which is where all the cost is.</p>
      </div>

      <div v-if="draftMode === 'ttt'" class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">Team climb pace: {{ tttClimbWkg === undefined ? `not set (${climbSliderWkg.toFixed(1)} W/kg, your normal power)` : `${tttClimbWkg.toFixed(1)} W/kg` }}</label>
        <USlider :model-value="climbSliderWkg" :min="TTT_MIN_CLIMB_WKG" :max="TTT_MAX_CLIMB_WKG" :step="0.1" @update:model-value="(value: number | undefined) => setTttClimbWkg(value ?? climbSliderWkg)" />
        <div class="flex justify-between text-xs text-muted mt-1"><span>{{ TTT_MIN_CLIMB_WKG }} W/kg</span><span>{{ TTT_MAX_CLIMB_WKG }} W/kg</span></div>
        <p class="text-sm text-muted mt-1">What the team averages on climbs over ~3.5 minutes, where the paceline breaks up and drafting gives almost nothing. <template v-if="tttClimbWkg === undefined">Untouched, so climbs are ridden at your normal power - the slider starts there.</template><template v-else>Set independently of your FTP: changing your power above won't move it. <ULink class="text-primary underline cursor-pointer" @click="setTttClimbWkg(undefined)">Go back to using my normal power</ULink>.</template></p>
      </div>
    </div>
  </UContainer>
</template>
