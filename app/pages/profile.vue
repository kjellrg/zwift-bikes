<script setup lang="ts">
const {
  weightKg,
  ftpWatts,
  wkg,
  defaultUnownedLevel,
  load,
  setWeightKg,
  setFtpWatts,
  setDefaultUnownedLevel
} = useRiderProfile()

onMounted(() => {
  load()
})

const defaultUnownedLevelOptions = [0, 1, 2, 3, 4, 5].map(level => ({
  label: level === 0 ? 'Level 0 (stock, just unlocked)' : `Level ${level}`,
  value: level
}))
</script>

<template>
  <UContainer class="py-10 space-y-8">
    <div>
      <h1 class="text-3xl font-bold text-highlighted">
        My Profile
      </h1>
      <p class="text-muted mt-1">
        Set your weight and FTP (functional threshold power) so route
        recommendations can estimate real finish times. Your W/kg is calculated
        automatically from these two values.
      </p>
    </div>

    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="Stored on this device only"
      description="Your profile is saved in this browser's local storage - there's no account system, so it won't follow you to another device or browser."
    />

    <div class="rounded-lg border border-default p-4 space-y-6">
      <div class="max-w-xs">
        <label class="block text-xs font-medium text-muted mb-1">Rider weight (kg)</label>
        <UInput
          :model-value="weightKg"
          type="number"
          min="30"
          max="150"
          step="1"
          @update:model-value="
            (value: string | number) => setWeightKg(Number(value))
          "
        />
      </div>

      <div class="max-w-md">
        <label class="block text-xs font-medium text-muted mb-1">
          FTP: {{ ftpWatts }} W
        </label>
        <USlider
          :model-value="ftpWatts"
          :min="50"
          :max="400"
          :step="1"
          @update:model-value="
            (value: number | undefined) => setFtpWatts(value ?? ftpWatts)
          "
        />
      </div>

      <div>
        <p class="text-xs font-medium text-muted uppercase tracking-wide">
          W/kg at FTP
        </p>
        <p class="text-2xl font-bold text-primary">
          {{ wkg.toFixed(2) }} W/kg
        </p>
        <p class="text-sm text-muted mt-1">
          {{ ftpWatts }} W ÷ {{ weightKg }} kg. This is the power-to-weight used
          to estimate finish times on route pages - you can still dial it up or
          down per route with that page's power slider.
        </p>
      </div>

      <div class="max-w-xs">
        <label class="block text-xs font-medium text-muted mb-1">
          Assumed upgrade level for bikes you don't own
        </label>
        <USelectMenu
          :model-value="defaultUnownedLevel"
          value-key="value"
          :items="defaultUnownedLevelOptions"
          :search-input="false"
          @update:model-value="(level: number) => setDefaultUnownedLevel(level)"
        />
        <p class="text-sm text-muted mt-1">
          Route recommendations score bikes in your garage at their actual
          upgrade level. For every other bike, they'll assume this level instead
          of the stock Level 0 default.
        </p>
      </div>
    </div>
  </UContainer>
</template>
