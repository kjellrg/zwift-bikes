<script setup lang="ts">
import type { DraftMode } from '../../shared/utils/physics/draft'

/**
 * The rider strip above the recommendation: the four numbers every finish
 * time on the page depends on (weight, height, power, draft mode), whether
 * they are the composable defaults or a saved profile, and the two ways to
 * change them - the profile dialog for the saved values, or "Adjust effort"
 * for the existing slider box (`RiderProfileControls`) folded away beneath.
 *
 * Power and draft mode arrive as props rather than being read from the
 * profile: they are what the ranking was ACTUALLY computed at (sprint power
 * on a sprint segment, the ride's own draft rule), which only the page's
 * request knows. Weight and height have no such substitution, so they are
 * read straight from the profile like the controls themselves do.
 */
const props = defineProps<{
  /** The power the results were ranked at - `useRecommendRequest().activePowerW`. */
  powerW: number
  /** The draft mode the results were ranked at - `useRecommendRequest().draftMode`. */
  draftMode: DraftMode
  /** Whether the times on screen are being recomputed. */
  refreshing: boolean
  /** Passed through to `RiderProfileControls` - see its own prop. */
  hasLongClimb?: boolean
  /** Whether the effort slider edits sprint power - see `RiderProfileControls`. */
  sprintPower?: boolean
}>()

const { weightKg, heightCm, hasStoredProfile } = useRiderProfile()
// The profile and garage links keep a real `href` for deep links and
// modifier-clicks, and are plain `<a>`s rather than ULinks: vue-router's own
// click handler would run before `preventDefault` - see `useOverlays`.
const { openProfile } = useOverlays()

const DRAFT_LABELS: Record<DraftMode, string> = { solo: 'Solo', race: 'Race draft', ttt: 'TTT paceline' }
const draftLabel = computed(() => DRAFT_LABELS[props.draftMode])

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
      />{{ weightKg }} kg</span>
      <span>{{ heightCm }} cm</span>
      <span class="inline-flex items-center gap-1.5"><UIcon
        name="i-lucide-zap"
        class="size-4 shrink-0"
      />{{ powerW }} W<span class="text-xs">{{ (powerW / weightKg).toFixed(2) }} W/kg{{ sprintPower ? ', sprint' : '' }}</span></span>
      <span class="inline-flex items-center gap-1.5"><UIcon
        name="i-lucide-users-round"
        class="size-4 shrink-0"
      />{{ draftLabel }}</span>
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
      />
    </div>
  </div>
</template>
