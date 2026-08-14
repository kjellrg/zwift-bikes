<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'

/**
 * Category / search / verified / garage filters, shared by every page that
 * ranks combos (`/routes/[slug]`, `/segments/[slug]`,
 * `/events/[season]/[race]`).
 *
 * Category and search stay `defineModel`s because they're page state that
 * feeds the page's own recommendation query; `verifiedOnly` / `myBikesOnly`
 * are read straight from `usePreferences`, which is `useState`-backed and so
 * stays in sync with the parent's watchers (same arrangement as
 * `RiderProfileControls`).
 */
const category = defineModel<BikeCategory | 'all'>('category', { required: true })
const search = defineModel<string>('search', { required: true })

const { hideTtCategory = false } = defineProps<{
  /**
   * Drops the TT option for races where Zwift disables TT frames, so the
   * filter can't offer a category the ranking below is excluding anyway.
   */
  hideTtCategory?: boolean
}>()

const { verifiedOnly, myBikesOnly, setVerifiedOnly, setMyBikesOnly } = usePreferences()

const categoryOptions = computed<{ label: string, value: BikeCategory | 'all' }[]>(() => [
  { label: 'All categories', value: 'all' },
  { label: BIKE_CATEGORY_LABELS.standard, value: 'standard' },
  ...(hideTtCategory ? [] : [{ label: BIKE_CATEGORY_LABELS.tt, value: 'tt' as const }]),
  { label: BIKE_CATEGORY_LABELS.gravel, value: 'gravel' },
  { label: BIKE_CATEGORY_LABELS.funbike, value: 'funbike' },
  { label: BIKE_CATEGORY_LABELS.handbike, value: 'handbike' }
])
</script>

<template>
  <div class="flex flex-wrap items-end gap-4 rounded-lg border border-default p-4 mb-6">
    <div class="min-w-48">
      <label class="block text-xs font-medium text-muted mb-1">Bike category</label><USelectMenu
        v-model="category"
        value-key="value"
        :items="categoryOptions"
        :search-input="false"
        class="w-52"
      />
    </div>
    <div class="min-w-56 flex-1">
      <label class="block text-xs font-medium text-muted mb-1">Search bikes or wheels</label><UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="e.g. Tarmac, Aethos, Zipp, DICUT..."
      />
    </div>
    <div class="flex items-center gap-2">
      <USwitch
        :model-value="verifiedOnly"
        @update:model-value="(value: boolean) => setVerifiedOnly(value)"
      /><span class="text-sm">Only show verified frames/wheels</span>
    </div>
    <div class="flex items-center gap-2">
      <USwitch
        :model-value="myBikesOnly"
        @update:model-value="(value: boolean) => setMyBikesOnly(value)"
      /><span class="text-sm">Only show items in my garage</span><ULink
        to="/garage"
        class="text-sm text-primary underline"
      >(edit garage)</ULink>
    </div>
  </div>
</template>
