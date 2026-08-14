<script setup lang="ts">
/**
 * Rider weight / height / power inputs, shared by every page that ranks
 * combos (`/routes/[slug]`, `/segments/[slug]`, `/events/[season]/[race]`).
 *
 * Reads and writes `useRiderProfile` directly rather than taking props: the
 * composable is `useState`-backed, so this component and its parent see the
 * same reactive state and the parent's existing `watch`es on `weightKg` /
 * `heightCm` / `wkg` still fire the recommendation refresh. Loading from
 * localStorage stays with the page (`onMounted`), so the profile is read
 * once per page rather than once per component.
 *
 * Height and power commit on `change`, not on `input`: both are ranges, and
 * refetching the full recommendation on every pixel of a drag was the reason
 * the draft/commit split exists.
 */
const { weightKg, heightCm, wkg, setWeightKg, setWkg, setHeightCm } = useRiderProfile()

const draftHeightCm = ref(heightCm.value)
const draftWkg = ref(wkg.value)
const commitHeight = () => setHeightCm(draftHeightCm.value)
const commitWkg = () => setWkg(draftWkg.value)
watch(heightCm, (value) => {
  draftHeightCm.value = value
})
watch(wkg, (value) => {
  draftWkg.value = value
})
</script>

<template>
  <div class="flex flex-wrap items-end gap-6 rounded-lg border border-default p-4 mb-6">
    <div class="w-40">
      <label class="block text-xs font-medium text-muted mb-1">Rider weight (kg)</label><UInput
        :model-value="weightKg"
        type="number"
        min="30"
        max="150"
        step="1"
        @update:model-value="(value: string | number) => setWeightKg(Number(value))"
      />
    </div>
    <div class="w-full sm:w-56">
      <label class="block text-xs font-medium text-muted mb-1">Height: {{ draftHeightCm }} cm</label><input
        v-model.number="draftHeightCm"
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
      <label class="block text-xs font-medium text-muted mb-1">Power: {{ draftWkg.toFixed(1) }} W/kg ({{ Math.round(draftWkg * weightKg) }} W)</label><input
        v-model.number="draftWkg"
        type="range"
        min="1"
        max="6.9"
        step="0.1"
        class="w-full cursor-pointer"
        aria-label="Rider power in watts per kilogram"
        @change="commitWkg"
      >
    </div>
    <ULink
      to="/profile"
      class="text-sm text-primary underline self-center"
    >(edit profile)</ULink>
  </div>
</template>
