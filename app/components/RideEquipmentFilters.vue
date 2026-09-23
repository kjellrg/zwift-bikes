<script setup lang="ts">
import type { BikeCategory } from '../../shared/types/catalog'
import { BIKE_CATEGORY_FILTERS } from '#shared/types/catalog'
import type { RiderInputs } from '../utils/recommendRequest'

/**
 * The equipment filters above the Ranking, as chips that show their state
 * with the list they produced: one category chip that opens a menu of the
 * six values, and on/off chips for verified data only, the garage and the
 * purchasable Halo bikes. A restriction the rider cannot see is one they
 * will blame the ranking for, so every value is on screen, never folded
 * away. There is no TT chip: TT is a category.
 *
 * Every chip binds `usePreferences()` through its setter, the same stored
 * values and Shared-view overrides as ever - the category is one persisted
 * value shared with the Rider card and the profile, and a page-local mirror
 * of it is where a spurious refetch loop would come from. "On" is drawn in
 * the ink, not the primary, which is spent on the answer.
 *
 * `load()` runs here because a child's `onMounted` fires before its
 * parent's, so the stored values are in state before the page reads them.
 */
const props = defineProps<{
  appliedRestrictions: RiderInputs
  /**
   * Whether this ride outlaws TT frames. The TT value is dropped from the
   * menu rather than disabled, because the ranking beneath could not honour
   * it, and a stored `tt` reads as "All categories" WITHOUT being written
   * back - the substitution `rideCategory` makes on the request side.
   */
  hideTtCategory?: boolean
}>()

const { verifiedOnly, myBikesOnly, bikeCategory, categoryFromLink, includeHaloBikes, load: loadPreferences, setVerifiedOnly, setMyBikesOnly, setBikeCategory, restoreBikeCategory, setIncludeHaloBikes } = usePreferences()
const { load: loadGarage } = useGarage()
// A real href for deep links and modifier-clicks; a plain click opens the
// garage Overlay - see `useOverlays`.
const { openGarage } = useOverlays()

onMounted(() => {
  loadPreferences()
  loadGarage()
})

const displayCategory = computed(() => props.hideTtCategory && bikeCategory.value === 'tt' ? 'all' : bikeCategory.value)
const categoryLabel = (value: BikeCategory | 'all') => value === 'all' ? 'All categories' : BIKE_CATEGORY_LABELS[value]
const categoryItems = computed(() => BIKE_CATEGORY_FILTERS
  .filter(value => !(props.hideTtCategory && value === 'tt'))
  .map(value => ({
    label: categoryLabel(value),
    type: 'checkbox' as const,
    checked: displayCategory.value === value,
    onSelect: () => setBikeCategory(value)
  })))

// Which of the four Garage fallback cases the ranking is under - the switch
// alone can't say, so this line does, and that the other filters still
// narrow the pool (see `garageFallback` and `CONTEXT.md`).
const garageScope = computed(() => {
  if (!props.appliedRestrictions.myBikesOnly) return undefined
  return GARAGE_FALLBACK_SCOPES[garageFallback({
    frames: Object.keys(props.appliedRestrictions.owned).length > 0,
    wheels: Object.keys(props.appliedRestrictions.ownedWheels).length > 0
  })]
})

const CHIP = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors'
const chipState = (on: boolean) => on ? 'border-ink bg-accented text-highlighted' : 'border-accented bg-elevated text-toned hover:text-highlighted'
</script>

<template>
  <div class="mt-4 space-y-2">
    <div
      role="group"
      aria-label="Equipment filters"
      class="flex flex-wrap items-center gap-2"
    >
      <UDropdownMenu
        :items="categoryItems"
        :content="{ align: 'start' }"
      >
        <button
          type="button"
          :class="[CHIP, chipState(true)]"
          :aria-label="`Category: ${categoryLabel(displayCategory)}`"
        >
          {{ categoryLabel(displayCategory) }}
          <UIcon
            name="i-lucide-chevron-down"
            class="size-3.5 text-muted"
          />
        </button>
      </UDropdownMenu>
      <!-- A category a link supplied for the visit, and the way out of it:
           restoring stores nothing; the refetch and the URL follow the ref. -->
      <FromLinkMarker
        v-if="categoryFromLink"
        restore-label="Restore my saved category"
        @restore="restoreBikeCategory"
      />
      <button
        type="button"
        role="switch"
        :aria-checked="verifiedOnly"
        :class="[CHIP, chipState(verifiedOnly)]"
        @click="setVerifiedOnly(!verifiedOnly)"
      >
        <UIcon
          v-if="verifiedOnly"
          name="i-lucide-check"
          class="size-3.5"
        />Verified data only
      </button>
      <button
        type="button"
        role="switch"
        :aria-checked="myBikesOnly"
        :class="[CHIP, chipState(myBikesOnly)]"
        @click="setMyBikesOnly(!myBikesOnly)"
      >
        <UIcon
          v-if="myBikesOnly"
          name="i-lucide-check"
          class="size-3.5"
        />My garage only
      </button>
      <button
        type="button"
        role="switch"
        :aria-checked="includeHaloBikes"
        :class="[CHIP, chipState(includeHaloBikes)]"
        title="The three purchasable Halo bikes are hidden by default - each takes three fully upgraded frames of one brand plus ~20 million Drops. Owned Halo bikes always stay eligible, and a search finds them regardless."
        @click="setIncludeHaloBikes(!includeHaloBikes)"
      >
        <UIcon
          v-if="includeHaloBikes"
          name="i-lucide-check"
          class="size-3.5"
        />Include Halo bikes
      </button>
      <a
        href="/garage"
        aria-haspopup="dialog"
        class="px-1 text-sm text-primary hover:underline"
        @click="openGarage"
      >Edit garage</a>
    </div>
    <p
      v-if="garageScope"
      class="text-sm text-muted"
      role="status"
    >
      {{ garageScope }}. Other filters and compatibility still apply.
    </p>
  </div>
</template>
