<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'
import { BIKE_CATEGORY_FILTERS } from '#shared/types/catalog'

/**
 * The equipment eligibility controls for a ranking page, in two tiers: the
 * garage and Halo switches stay visible, the category and verified-only
 * controls sit behind "More filters" with their current values always shown
 * beside the button - a restriction the rider cannot see is a restriction
 * they will blame the ranking for.
 *
 * Every control binds `usePreferences()` directly through its setter: the
 * category is one persisted value shared with the profile page, and a
 * page-local mirror of it is where a spurious refetch loop would come from.
 * Search is deliberately not here - it sits on the ranked list it filters.
 *
 * `loadPreferences()`/`loadGarage()` run here because a child's `onMounted`
 * fires before its parent's, so the stored values are in state before the
 * page reads them - the same reason `RiderProfileControls` loads its own.
 */
const props = defineProps<{
  /**
   * Whether this ride outlaws TT frames - a points or scratch race, or a
   * Race of Truth. The TT option is dropped rather than disabled, because
   * the ranking beneath could not honour it: a filter must never offer a
   * category the results would refuse to show. A rider whose stored category
   * IS `tt` reads "All categories" here instead, WITHOUT that being written
   * back - which is exactly the substitution `rideCategory` makes on the
   * request side, so the control and the ranking say the same thing, and
   * their saved choice survives for the pages where TT is legal.
   */
  hideTtCategory?: boolean
}>()

const { verifiedOnly, myBikesOnly, bikeCategory, categoryFromLink, includeHaloBikes, load: loadPreferences, setVerifiedOnly, setMyBikesOnly, setBikeCategory, restoreBikeCategory, setIncludeHaloBikes } = usePreferences()
const { owned, ownedWheels, load: loadGarage } = useGarage()
// The profile and garage links keep a real `href` for deep links and
// modifier-clicks, and are plain `<a>`s rather than ULinks: vue-router's own
// click handler would run before `preventDefault` - see `useOverlays`.
const { openGarage } = useOverlays()

onMounted(() => {
  loadPreferences()
  loadGarage()
})

const categoryOptions = computed(() => BIKE_CATEGORY_FILTERS
  .filter(value => !(props.hideTtCategory && value === 'tt'))
  .map(value => ({ label: value === 'all' ? 'All categories' : BIKE_CATEGORY_LABELS[value], value })))
// What the select points at and what the summary line beside the button
// reads - see `hideTtCategory`. Both go through it, or the select would
// point at an option that is not in its list.
const displayCategory = computed(() => props.hideTtCategory && bikeCategory.value === 'tt' ? 'all' : bikeCategory.value)
const categoryLabel = computed(() => displayCategory.value === 'all' ? 'All categories' : BIKE_CATEGORY_LABELS[displayCategory.value])

// The server falls back independently per collection when "my garage" is on:
// no owned frames means every frame, no owned wheels means every compatible
// wheel. The switch alone can't show which of the four cases applies, so
// this line does - and says that the other filters still narrow the pool.
// The four cases themselves are `garageFallback`, shared with the garage,
// which explains an empty tab with the same rule (see `CONTEXT.md`).
const garageScope = computed(() => {
  if (!myBikesOnly.value) return undefined
  return GARAGE_FALLBACK_SCOPES[garageFallback({
    frames: Object.keys(owned.value).length > 0,
    wheels: Object.keys(ownedWheels.value).length > 0
  })]
})

const moreFilters = ref(false)
const moreFiltersId = useId()
const categoryId = useId()
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-default py-4 text-sm"
    aria-label="Equipment filters"
    role="group"
  >
    <USwitch
      :model-value="myBikesOnly"
      label="My garage only"
      @update:model-value="(value: boolean) => setMyBikesOnly(value)"
    />
    <a
      href="/garage"
      class="inline-flex items-center gap-1.5 text-primary hover:underline"
      aria-haspopup="dialog"
      @click="openGarage"
    ><UIcon
      name="i-lucide-pencil"
      class="size-4 shrink-0"
    />Edit garage</a>
    <USwitch
      :model-value="includeHaloBikes"
      label="Include Halo bikes"
      @update:model-value="(value: boolean) => setIncludeHaloBikes(value)"
    />
    <UTooltip text="The three purchasable Halo bikes are hidden by default - each takes three fully upgraded frames of one brand plus ~20 million Drops. Owned Halo bikes always stay eligible, and a search finds them regardless.">
      <UButton
        icon="i-lucide-circle-help"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="About Halo bike filtering"
      />
    </UTooltip>
    <UButton
      icon="i-lucide-list-filter"
      size="sm"
      color="primary"
      variant="link"
      class="px-0"
      :aria-expanded="moreFilters"
      :aria-controls="moreFiltersId"
      @click="moreFilters = !moreFilters"
    >
      More filters
    </UButton>
    <span class="text-xs text-muted">{{ categoryLabel }} / {{ verifiedOnly ? 'Verified only' : 'Includes estimates' }}</span>
    <!-- A category a link supplied for the visit, and the way out of it:
         restoring stores nothing, the refetch and the URL follow from the
         ref moving. A sibling of the summary rather than inside it, so the
         summary's text stays the two values it names. -->
    <FromLinkMarker
      v-if="categoryFromLink"
      class="-ml-3"
      restore-label="Restore my saved category"
      @restore="restoreBikeCategory"
    />
    <div
      v-if="moreFilters"
      :id="moreFiltersId"
      class="flex w-full flex-wrap items-end gap-6 border-t border-default pt-4"
    >
      <div class="w-56 max-w-full">
        <label
          :for="categoryId"
          class="mb-1 block text-xs font-medium text-muted"
        >Bike category</label>
        <USelect
          :id="categoryId"
          :model-value="displayCategory"
          :items="categoryOptions"
          value-key="value"
          aria-label="Bike category"
          class="w-full"
          @update:model-value="(value: BikeCategory | 'all') => setBikeCategory(value)"
        />
      </div>
      <USwitch
        :model-value="verifiedOnly"
        label="Verified frames and wheels only"
        class="pb-2"
        @update:model-value="(value: boolean) => setVerifiedOnly(value)"
      />
    </div>
    <p
      v-if="garageScope"
      class="w-full text-xs text-muted"
      role="status"
    >
      {{ garageScope }}. Other filters and compatibility still apply.
    </p>
  </div>
</template>
