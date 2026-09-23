<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import type { DraftMode } from '../../shared/utils/physics/draft'
import { comboPhysicsDelta, formatSignedDelta, isDynamicPhysics } from '../utils/rankingResults'
import { aeroShare, whyThisWins } from '../utils/rideWhy'

/**
 * "Why this bike wins here": the reason behind the Recommendation's number,
 * from data the response already carries and nothing else - a few templated
 * sentences (`whyThisWins`), what the terrain rewards drawn as a two-part
 * aero-against-weight bar, and rank 1's own figures: its physics against the
 * stock bike, what rough surfaces cost it, and which physics model timed it.
 *
 * Equipment-dependent, so it reads the APPLIED Ranking - its course and its
 * rank 1 - and dims through a refresh like the answer it explains.
 */
const props = defineProps<{
  /** The course the times were computed over - `appliedRanking.course`. */
  course: RouteWithMeta | undefined
  /** Rank 1; absent with zero matches. */
  combo: ComboScore | undefined
  /** The Ride in the page's words, for the sentence: "The Mega Pretzel". */
  rideName: string
  physicsMode: string | undefined
  /** The draft mode the times were computed under - `appliedInputs.draftMode`. */
  draftMode: DraftMode
  refreshing: boolean
}>()

const share = computed(() => props.course ? aeroShare(props.course.terrain.weights) : 0.5)
const sentence = computed(() => props.course && props.combo
  ? whyThisWins({
      rideName: props.rideName,
      category: props.course.terrain.category,
      climbRatio: props.course.terrain.climbRatio,
      weights: props.course.terrain.weights,
      frameName: props.combo.frame.name,
      frameStyle: props.combo.frame.style,
      frameCategory: props.combo.frame.category,
      draftMode: props.draftMode
    })
  : undefined)
const delta = computed(() => props.combo ? comboPhysicsDelta(props.combo) : undefined)
const surfaceCost = computed(() => {
  const penalty = Math.round(props.combo?.surfaceTimePenaltySec ?? 0)
  if (!penalty) return undefined
  // Rounded first, so 59.7 s reads 1:00 rather than 60 s.
  return penalty < 60 ? `${penalty} s` : formatDuration(penalty)
})
</script>

<template>
  <section
    aria-labelledby="ride-why-heading"
    class="min-w-0"
  >
    <h2
      id="ride-why-heading"
      class="text-2xl font-semibold font-heading text-highlighted"
    >
      Why this bike wins here
    </h2>
    <p
      v-if="!combo || !course"
      class="mt-3 text-toned"
    >
      Nothing is ranked under the current filters, so there is no winner to explain.
    </p>
    <div
      v-else
      class="transition-opacity"
      :class="{ 'opacity-60': refreshing }"
    >
      <p class="mt-3 max-w-[60ch] text-toned">
        {{ sentence }}
      </p>
      <div class="mt-5">
        <p class="text-xs text-muted">
          What the terrain rewards, from its climbing alone: aerodynamics against low weight
        </p>
        <div
          class="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-[3px]"
          aria-hidden="true"
        >
          <span
            class="block h-full bg-ink"
            :style="{ width: `${(share * 100).toFixed(1)}%` }"
          />
          <span
            class="block h-full bg-ink-muted"
            :style="{ width: `${((1 - share) * 100).toFixed(1)}%` }"
          />
        </div>
        <p class="mt-2 flex flex-wrap gap-x-5 text-sm text-toned">
          <span class="inline-flex items-center gap-1.5"><span
            class="inline-block size-2.5 rounded-[2px] bg-ink"
            aria-hidden="true"
          />Aerodynamics {{ Math.round(share * 100) }}%</span>
          <span class="inline-flex items-center gap-1.5"><span
            class="inline-block size-2.5 rounded-[2px] bg-ink-muted"
            aria-hidden="true"
          />Weight on climbs {{ Math.round((1 - share) * 100) }}%</span>
        </p>
      </div>
      <dl class="mt-5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-default pt-3 text-md">
        <template v-if="delta">
          <dt class="text-toned">
            Drag area against the stock bike
          </dt>
          <dd class="text-right">
            {{ formatSignedDelta(delta.cdaDeltaM2, 4) }} m²
          </dd>
          <dt class="text-toned">
            Mass against the stock bike
          </dt>
          <dd class="text-right">
            {{ formatSignedDelta(delta.bikeMassDeltaKg, 2) }} kg
          </dd>
          <dt class="text-toned">
            Rolling resistance change
          </dt>
          <dd class="text-right">
            {{ formatSignedDelta(delta.crrDelta, 4) }}
          </dd>
        </template>
        <dt class="text-toned">
          Time lost to rough surfaces
        </dt>
        <dd class="text-right">
          {{ surfaceCost ?? 'none' }}
        </dd>
        <dt class="text-toned">
          Physics model
        </dt>
        <dd class="text-right">
          {{ isDynamicPhysics(physicsMode ? { mode: physicsMode } : undefined) ? 'Dynamic, measured geometry' : 'Legacy estimate' }}
        </dd>
      </dl>
      <p
        v-if="!delta"
        class="mt-2 text-xs text-muted"
      >
        Only bot-tested equipment has solved drag-area and mass figures.
      </p>
    </div>
  </section>
</template>
