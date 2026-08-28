<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'

/**
 * The bike filter row: category select, search box, verified-only and
 * my-garage switches - shared verbatim by the route, segment and event race
 * pages.
 *
 * Search is the only page-owned piece of state (each page debounces it into
 * its own recommend query), so it's a `defineModel`. Everything else binds
 * `usePreferences()` directly: `bikeCategory` is a persisted preference and
 * must NOT be mirrored into a page-local ref - it is one shared value with
 * the profile page, so changing it here persists it, and there is no second
 * ref to keep in sync (which is where a spurious refetch loop would come
 * from). `loadPreferences()` runs here for the same child-before-parent
 * `onMounted` reason as in `RiderProfileControls`.
 *
 * `hideTtCategory` drops the TT entry from the options - for event race
 * pages where the format outlaws TT frames, so the filter can't offer a
 * category the race page's ranking would refuse to show.
 */
const props = defineProps<{ hideTtCategory?: boolean }>()

const search = defineModel<string>('search', { default: '' })

const { verifiedOnly, myBikesOnly, bikeCategory, includeHaloBikes, load: loadPreferences, setVerifiedOnly, setMyBikesOnly, setBikeCategory, setIncludeHaloBikes } = usePreferences()

onMounted(() => {
  loadPreferences()
})

const categoryOptions = computed<{ label: string, value: BikeCategory | 'all' }[]>(() => [
  { label: 'All categories', value: 'all' as const }, { label: BIKE_CATEGORY_LABELS.standard, value: 'standard' as const },
  { label: BIKE_CATEGORY_LABELS.tt, value: 'tt' as const }, { label: BIKE_CATEGORY_LABELS.gravel, value: 'gravel' as const },
  { label: BIKE_CATEGORY_LABELS.funbike, value: 'funbike' as const }, { label: BIKE_CATEGORY_LABELS.handbike, value: 'handbike' as const }
].filter(option => !(props.hideTtCategory && option.value === 'tt')))

// A rider whose persisted category is `tt` opening a page that hides the TT
// option would otherwise see a select pointing at an option that isn't there.
// Shown as "All categories" instead - WITHOUT writing that back to the
// preference (the race page's query makes the same substitution), so their
// stored choice survives for the pages where TT is legal.
const displayCategory = computed(() => props.hideTtCategory && bikeCategory.value === 'tt' ? 'all' : bikeCategory.value)

// "(edit garage)" opens the garage modal over this page rather than
// navigating away from the route the rider is looking at - toggling a bike
// writes straight through `useGarage`, so the ranking below refreshes
// underneath the modal. A plain `<a href="/garage">` rather than a ULink:
// deep links and modifier-click still reach the real page, and vue-router's
// own click handler would otherwise run before `preventDefault`.
const { openGarage } = useOverlays()
</script>

<template>
  <div class="flex flex-wrap items-end gap-4 rounded-lg border border-default p-4">
    <div class="min-w-48">
      <label class="block text-xs font-medium text-muted mb-1">Bike category</label>
      <USelectMenu
        :model-value="displayCategory"
        value-key="value"
        :items="categoryOptions"
        :search-input="false"
        class="w-52"
        @update:model-value="(value: BikeCategory | 'all') => setBikeCategory(value)"
      />
    </div>
    <div class="min-w-56 flex-1">
      <label class="block text-xs font-medium text-muted mb-1">Search bikes or wheels</label>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="e.g. Tarmac, Aethos, Zipp, DICUT..."
      />
    </div>
    <div class="flex items-center gap-2">
      <USwitch
        :model-value="verifiedOnly"
        aria-label="Only show verified frames/wheels"
        @update:model-value="(value: boolean) => setVerifiedOnly(value)"
      /><span class="text-sm">Only show verified frames/wheels</span>
    </div>
    <div class="flex items-center gap-2">
      <USwitch
        :model-value="includeHaloBikes"
        aria-label="Include hard-to-unlock Halo bikes"
        @update:model-value="(value: boolean) => setIncludeHaloBikes(value)"
      /><span class="text-sm">Include hard-to-unlock Halo bikes</span>
    </div>
    <div class="flex items-center gap-2">
      <USwitch
        :model-value="myBikesOnly"
        aria-label="Only show items in my garage"
        @update:model-value="(value: boolean) => setMyBikesOnly(value)"
      /><span class="text-sm">Only show items in my garage</span><a
        href="/garage"
        class="text-sm text-primary underline"
        @click="openGarage"
      >(edit garage)</a>
    </div>
  </div>
</template>
