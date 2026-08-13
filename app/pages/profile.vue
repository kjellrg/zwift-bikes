<script setup lang="ts">
const { weightKg, heightCm, ftpWatts, wkg, defaultUnownedLevel, load, setWeightKg, setHeightCm, setFtpWatts, setDefaultUnownedLevel } = useRiderProfile()
onMounted(() => { load() })

// Everything on this page renders from localStorage, so a crawler only ever
// sees an empty shell - thin content with nothing to rank for. Keep it out
// of the index, but still follow its links out. `useRobotsRule` (from
// @nuxtjs/robots) rather than `useSeoMeta`, so this owns the single robots
// meta tag the module manages instead of racing it, and sets the matching
// X-Robots-Tag header too.
useRobotsRule('noindex, follow')
const defaultUnownedLevelOptions = [0, 1, 2, 3, 4, 5].map(level => ({ label: level === 0 ? 'Level 0 (stock, just unlocked)' : `Level ${level}`, value: level }))
</script>

<template>
  <UContainer class="py-10 space-y-8">
    <div>
      <h1 class="text-3xl font-bold text-highlighted">My Profile</h1>
      <p class="text-muted mt-1">Set your weight, height and FTP so route recommendations can estimate finish times using the dynamic physics model. Your profile is stored locally in this browser.</p>
    </div>

    <UAlert color="neutral" variant="subtle" icon="i-lucide-info" title="Stored on this device only" description="Your profile is saved in this browser's local storage - there's no account system, so it won't follow you to another device or browser." />

    <div class="rounded-lg border border-default p-4 space-y-6">
      <div class="max-w-xs">
        <label class="block text-xs font-medium text-muted mb-1">Rider weight (kg)</label>
        <UInput :model-value="weightKg" type="number" min="30" max="150" step="1" @update:model-value="(value: string | number) => setWeightKg(Number(value))" />
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
    </div>
  </UContainer>
</template>
