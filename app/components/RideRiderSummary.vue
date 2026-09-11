<script setup lang="ts">
import type { AppliedRiderInputs } from '../utils/recommendRequest'

/**
 * The rider strip above the recommendation: the four numbers every finish
 * time on the page depends on (weight, height, power, draft mode), whether
 * they are the composable defaults or a saved profile, and the two ways to
 * change them - the profile dialog for the saved values, or "Adjust effort"
 * for the existing slider box (`RiderProfileControls`) folded away beneath.
 *
 * Every number is the APPLIED rider (see `CONTEXT.md`): what the times on
 * screen were computed from, which only the page's request knows - sprint
 * power on a sprint segment, the ride's own draft rule, and the weight and
 * height the response was fetched for. The slider box beneath shows the
 * live pending values instead; between a release and the response the two
 * differ, and this strip lags under its "Updating estimates" spinner so a
 * time is never explained by inputs it was not computed from.
 *
 * A draft mode a link supplied gets a "from link" marker: the strip is
 * where the rider reads which mode the times assume, so it is also where
 * they can drop the link's mode for their own saved one. Not under
 * `draftLocked`, where no draft mode is honoured at all and the marker would
 * offer to restore a saved value this ride would ignore just as thoroughly.
 */
const props = defineProps<{
  /** The rider the results were ranked for - `useRecommendRequest().appliedInputs`. */
  rider: AppliedRiderInputs
  /** Whether the times on screen are being recomputed. */
  refreshing: boolean
  /** Passed through to `RiderProfileControls` - see its own prop. */
  hasLongClimb?: boolean
  /** Whether the effort slider edits sprint power - see `RiderProfileControls`. */
  sprintPower?: boolean
  /** Whether this ride is ridden with no draft at all, which hides the draft controls beneath - see `RiderProfileControls`. */
  draftLocked?: boolean
}>()

const { hasStoredProfile, draftModeFromLink, restoreDraftMode } = useRiderProfile()
// The profile and garage links keep a real `href` for deep links and
// modifier-clicks, and are plain `<a>`s rather than ULinks: vue-router's own
// click handler would run before `preventDefault` - see `useOverlays`.
const { openProfile } = useOverlays()

const draftLabel = computed(() => DRAFT_MODE_LABELS[props.rider.draftMode])

const adjustEffort = ref(false)
const controlsId = useId()
</script>

<template>
  <div>
    <div
      class="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-default py-3 text-sm text-muted"
      role="group"
      aria-label="Rider"
    >
      <span class="inline-flex items-center gap-1.5"><UIcon
        name="i-lucide-user-round"
        class="size-4 shrink-0"
      />{{ rider.weightKg }} kg</span>
      <span>{{ rider.heightCm }} cm</span>
      <span class="inline-flex items-center gap-1.5"><UIcon
        name="i-lucide-zap"
        class="size-4 shrink-0"
      />{{ rider.powerW }} W<span class="text-xs">{{ (rider.powerW / rider.weightKg).toFixed(2) }} W/kg{{ sprintPower ? ', sprint' : '' }}</span></span>
      <span class="inline-flex items-center gap-1.5">
        <UIcon
          name="i-lucide-users-round"
          class="size-4 shrink-0"
        />{{ draftLabel }}
        <!-- Restoring stores nothing; the refetch and the URL follow from the
             ref moving, as for any control. -->
        <FromLinkMarker
          v-if="draftModeFromLink && !draftLocked"
          restore-label="Restore my saved draft mode"
          @restore="restoreDraftMode"
        />
      </span>
      <!-- Until a profile is saved every time on the page is for the
           defaults - say so, or a first visit reads as a prediction. -->
      <span
        v-if="!hasStoredProfile"
        class="text-xs font-medium text-warning"
      >Using default rider</span>
      <a
        href="/profile"
        class="inline-flex items-center gap-1.5 text-primary hover:underline"
        aria-haspopup="dialog"
        @click="openProfile"
      ><UIcon
        name="i-lucide-pencil"
        class="size-4 shrink-0"
      />{{ hasStoredProfile ? 'Edit profile' : 'Set your profile' }}</a>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 text-primary hover:underline"
        :aria-expanded="adjustEffort"
        :aria-controls="controlsId"
        @click="adjustEffort = !adjustEffort"
      >
        <UIcon
          name="i-lucide-sliders-horizontal"
          class="size-4 shrink-0"
        />Adjust effort
      </button>
      <span class="inline-flex items-center gap-1.5 text-xs sm:ml-auto">
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
        {{ refreshing ? 'Updating estimates…' : 'Estimated finish times' }}
      </span>
    </div>
    <div
      v-show="adjustEffort"
      :id="controlsId"
      class="mt-4"
    >
      <RiderProfileControls
        v-if="adjustEffort"
        :has-long-climb="hasLongClimb"
        :sprint-power="sprintPower"
        :draft-locked="draftLocked"
      />
    </div>
  </div>
</template>
