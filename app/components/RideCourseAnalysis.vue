<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import type { TttPlan } from '../composables/useTttPlan'
import type { AppliedRiderInputs } from '../utils/recommendRequest'
import { MIN_ROUTE_KM, type RacePlanItem } from '#shared/utils/physics/racePlan'
import { expandClimbsForLaps, expandSprintsForLaps } from '#shared/utils/routeOccurrences'

/**
 * The course-analysis tabs under a route or segment page: the Ride-only
 * views (Elevation, Segments, Surface details), which exist with zero
 * equipment matches and through a results refresh, and the equipment views
 * (Speed & surface, TTT plan), which describe one ranked setup and say so.
 *
 * Every panel is in the server HTML (`unmount-on-hide` off), so the segment
 * links exist before any interaction and a hidden panel is merely hidden.
 * Which tab shows is page memory (`useCourseAnalysisTab`), never the URL.
 *
 * Two Rides on purpose, not one. The Ride-only tabs follow the selector
 * (`route`, `laps`), like the briefing: they describe the ride the rider has
 * chosen. The equipment tabs follow the APPLIED results (`resultsRoute`,
 * `resultsLaps`, `combo`, `rider`): a plan priced for a setup must describe
 * the ride and the rider that setup was ranked for, and during a refresh
 * they keep the previous results, dimmed, exactly as the recommendation
 * does. On a route or a segment the two Rides are always the same course and
 * `resultsRoute` is left off; on a race the category group can move the
 * course itself, and a speed curve drawn on the new course for a setup
 * ranked on the old one is a chart of a bike that was never ranked there.
 * The TTT plan itself arrives from the page (`useTttPlan`), which computes
 * it once for the briefing's TTT line and this tab, so the two cannot
 * disagree.
 */
const props = defineProps<{
  /** The route the rider has selected, or the synthetic segment-as-route the segment page ranks against. The Ride-only tabs describe this one. */
  route: RouteWithMeta
  /** The route the applied results were ranked on, where a page can move the course under them. Defaults to `route`. */
  resultsRoute?: RouteWithMeta
  /** What the page ranks: a route gets the Segments tab; a sprint has no speed chart (a standing-start simulation says nothing about a flying sprint). */
  kind: 'route' | 'climb' | 'sprint'
  /** The picker's lap count, which the Ride-only tabs follow. 1 on a segment. */
  laps: number
  /** The lap count the applied results were computed for - `appliedRide.laps` - which the equipment tabs follow. */
  resultsLaps: number
  /** The applied top combo; absent with zero matches. */
  combo?: ComboScore
  /** The rider the applied results were computed for - `useRecommendRequest().appliedInputs`. */
  rider: AppliedRiderInputs
  /** Whether the results are being recomputed - the equipment panels dim like the recommendation. */
  refreshing: boolean
  /** Whether the first ranking is still pending (nothing on screen yet) - `isFirstLoad`, so a loading state never reads as zero matches. */
  loading: boolean
  /** The page's TTT plan, present under TTT drafting only - its presence is what adds the tab. */
  plan?: TttPlan
  /** Whether this ride scores points along the way - a race. Adds the Scoring tab, whose content is the page's own through the `scoring` slot. */
  scoring?: boolean
  /** The scoring segments that have a page here, starred on the elevation profile in ride order - see `RouteElevationProfile`. */
  scoringSlugs?: string[]
}>()

const { selected } = useCourseAnalysisTab()

const isRoute = computed(() => props.kind === 'route')
const hasElevation = computed(() => (props.route.terrain.elevationProfile?.length ?? 0) > 1)
const leadInKm = computed(() => props.route.leadInDistance ?? 0)

// The applied course, for the two tabs that describe a ranked setup on it.
const equipmentRoute = computed(() => props.resultsRoute ?? props.route)
// True only while the applied results are still a previous course's - the
// window between a race's group moving and its ranking landing. The scope
// lines name the course then, so a curve under a freshly changed selector is
// never read as the course now selected.
const equipmentCourseDiffers = computed(() => props.resultsRoute !== undefined && props.resultsRoute.slug !== props.route.slug)
const equipmentLeadInKm = computed(() => equipmentRoute.value.leadInDistance ?? 0)
const equipmentHasElevation = computed(() => (equipmentRoute.value.terrain.elevationProfile?.length ?? 0) > 1)
const equipmentHasSurfaceLocations = computed(() => (equipmentRoute.value.surface.segments?.length ?? 0) > 0)

const items = computed(() => [
  { label: 'Elevation', value: 'elevation' as const, slot: 'elevation' as const, icon: 'i-lucide-mountain' },
  ...(props.scoring ? [{ label: 'Scoring', value: 'scoring' as const, slot: 'scoring' as const, icon: 'i-lucide-trophy' }] : []),
  ...(isRoute.value ? [{ label: 'Segments', value: 'segments' as const, slot: 'segments' as const, icon: 'i-lucide-route' }] : []),
  ...(props.kind !== 'sprint' ? [{ label: 'Speed & surface', value: 'speed' as const, slot: 'speed' as const, icon: 'i-lucide-gauge' }] : []),
  { label: 'Surface details', value: 'surface' as const, slot: 'surface' as const, icon: 'i-lucide-layers' },
  ...(props.plan ? [{ label: 'TTT plan', value: 'plan' as const, slot: 'plan' as const, icon: 'i-lucide-flag' }] : [])
])
// The remembered tab may have left the set: the plan when draft mode leaves
// ttt, the speed chart on a sprint page, the scoring of a race whose group
// has none. Elevation is always there.
watch(items, (list) => {
  if (!list.some(item => item.value === selected.value)) selected.value = 'elevation'
}, { immediate: true })

const lapsLabel = (count: number) => `${count} lap${count === 1 ? '' : 's'}`

const climbs = computed(() => isRoute.value ? expandClimbsForLaps(props.route, props.laps) : [])
const sprints = computed(() => isRoute.value ? expandSprintsForLaps(props.route, props.laps) : [])
const segments = computed(() => isRoute.value ? courseSegmentsInRideOrder(props.route, props.laps) : [])

const elevationScope = computed(() => isRoute.value
  ? `Measured elevation profile; ${lapsLabel(props.laps)}${leadInKm.value > 0 ? ', lead-in included once' : ''}.`
  : 'Measured elevation profile of the timed segment.')
const elevationUnavailable = computed(() =>
  `Elevation profile unavailable; the estimate uses the ${isRoute.value ? 'route\'s distance' : 'segment\'s length'} and climbing totals.`)

const segmentsScope = computed(() => leadInKm.value > 0
  ? `${lapsLabel(props.laps)}; kilometre positions include the lead-in, ridden once.`
  : `${lapsLabel(props.laps)}; kilometre positions are from the ride start.`)

const setupLabel = computed(() => props.combo
  ? `${props.combo.frame.name} / ${props.combo.wheelset?.name ?? 'fixed disc wheels'}`
  : undefined)
/** Which course these results are for, said out loud only when it is not the selected one. */
const courseNote = computed(() => equipmentCourseDiffers.value ? ` on ${equipmentRoute.value.name}` : '')

// Always one lap - see `computeRouteSurfaceSpeedProfile` - while the finish
// estimate above is for every selected lap, so the scope says both.
const speedScope = computed(() => {
  const ride = !isRoute.value
    ? 'route-style simulation from a standing start, not the timed estimate'
    : equipmentRoute.value.lap
      ? `one lap${equipmentLeadInKm.value > 0 ? ' plus the lead-in' : ''}; the finish estimate covers ${lapsLabel(props.resultsLaps)}`
      : 'the whole ride'
  return `${setupLabel.value}${courseNote.value} · ${props.rider.powerW} W · ${DRAFT_MODE_LABELS[props.rider.draftMode]} · ${ride}.`
})
const speedUnavailable = computed(() => {
  if (equipmentHasElevation.value && equipmentHasSurfaceLocations.value) return undefined
  const missing = !equipmentHasElevation.value && !equipmentHasSurfaceLocations.value
    ? 'elevation and surface locations are missing'
    : !equipmentHasElevation.value ? 'the elevation profile is missing' : 'surface locations are missing'
  return `Speed & surface profile unavailable: ${missing}. No curve is inferred from the overall surface mix.`
})

const surfaceScope = computed(() =>
  `${surfaceCoverageLine(props.route.surface)}; the mix describes ${isRoute.value ? 'one lap' : 'the timed segment'}. `
  + 'Crr is Zwift\'s rolling resistance per surface and wheel class - higher means more effort at the same speed; see THIRD_PARTY_NOTICES.md for the data source.')

const planScope = computed(() => {
  if (!props.plan) return undefined
  const ride = isRoute.value
    ? `${lapsLabel(props.resultsLaps)}${equipmentLeadInKm.value > 0 ? ', lead-in included once' : ''}; distances are from the ride start`
    : 'from the start of the timed segment; warm-up excluded'
  const team = `${props.plan.riders}-rider paceline${props.plan.climbWkg ? `, team climb pace ${props.plan.climbWkg.toFixed(1)} W/kg` : ''}`
  return `${setupLabel.value}${courseNote.value} · ${props.rider.powerW} W · ${team} · ${ride}.`
})
const PLAN_ICONS: Record<RacePlanItem['type'], string> = { climb: 'i-lucide-mountain', surface: 'i-lucide-triangle-alert' }
</script>

<template>
  <section
    :id="COURSE_ANALYSIS_ID"
    aria-labelledby="course-analysis-heading"
    tabindex="-1"
    class="space-y-4 scroll-mt-6 outline-none"
  >
    <h2
      id="course-analysis-heading"
      class="text-xl font-semibold text-highlighted"
    >
      Course analysis
    </h2>
    <!-- The list wraps rather than scrolls so every tab is visible on a phone;
         the sliding indicator only knows one row, so the active trigger draws
         its own underline instead. -->
    <UTabs
      v-model="selected"
      :items="items"
      variant="link"
      :unmount-on-hide="false"
      :ui="{
        list: 'flex-wrap gap-x-1',
        indicator: 'hidden',
        trigger: 'data-[state=active]:text-highlighted data-[state=active]:after:content-[\'\'] data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary',
        content: 'pt-4'
      }"
    >
      <template #elevation>
        <div class="space-y-3">
          <p class="text-xs text-muted">
            {{ hasElevation ? elevationScope : elevationUnavailable }}
          </p>
          <RouteElevationProfile
            v-if="hasElevation"
            :route="route"
            :laps="laps"
            :climbs="climbs"
            :sprints="sprints"
            :scoring-slugs="scoringSlugs"
            flat
          />
        </div>
      </template>

      <!-- Ride-only, and the page's own: where the points are is a property
           of the race's rules, not of anything that was ranked. -->
      <template #scoring>
        <slot name="scoring" />
      </template>

      <template #segments>
        <div class="space-y-3">
          <p class="text-xs text-muted">
            {{ segmentsScope }}
          </p>
          <ol
            v-if="segments.length"
            aria-label="Segments in ride order"
            class="divide-y divide-default"
          >
            <li
              v-for="(segment, index) in segments"
              :key="`${segment.slug}-${segment.rideFromKm}-${index}`"
              class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm"
            >
              <UIcon
                :name="segment.kind === 'climb' ? 'i-lucide-mountain' : 'i-lucide-zap'"
                class="size-4 shrink-0"
                :class="segment.kind === 'climb' ? 'text-success' : 'text-warning'"
              />
              <div class="min-w-0 flex-1">
                <ULink
                  :to="`/segments/${segment.slug}`"
                  class="font-medium text-primary underline"
                >{{ segment.name }}</ULink>
                <p class="text-xs text-muted">
                  km {{ segment.rideFromKm.toFixed(1) }}-{{ segment.rideToKm.toFixed(1) }}<template v-if="segment.lapNumber">
                    / lap {{ segment.lapNumber }}
                  </template><template v-else-if="segment.leadIn">
                    / lead-in
                  </template>
                </p>
              </div>
              <span class="text-xs text-muted">
                {{ segment.kind === 'climb' ? 'Climb' : 'Sprint' }}<template v-if="segment.climbType"> / {{ segment.climbType === 'HC' ? 'HC' : `Cat ${segment.climbType}` }}</template>
              </span>
              <dl class="flex w-full gap-x-5 pl-8 text-xs sm:w-auto sm:pl-0">
                <div>
                  <dt class="text-muted">
                    Length
                  </dt><dd class="tabular-nums text-highlighted">
                    {{ formatDistance(segment.lengthKm) }}
                  </dd>
                </div>
                <div v-if="segment.elevationM !== undefined">
                  <dt class="text-muted">
                    Elevation
                  </dt><dd class="tabular-nums text-highlighted">
                    {{ formatElevation(segment.elevationM) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">
                    Avg grade
                  </dt><dd class="tabular-nums text-highlighted">
                    {{ segment.avgGradePercent ? formatGrade(segment.avgGradePercent) : 'Flat' }}
                  </dd>
                </div>
              </dl>
            </li>
          </ol>
          <p
            v-else
            class="text-sm text-muted"
          >
            No mapped climbs or sprints on this route.
          </p>
        </div>
      </template>

      <template #speed>
        <div class="space-y-3">
          <p
            v-if="speedUnavailable"
            class="text-sm text-muted"
          >
            {{ speedUnavailable }}
          </p>
          <p
            v-else-if="!combo"
            class="text-sm text-muted"
          >
            <template v-if="loading">
              The speed &amp; surface profile follows the ranking.
            </template>
            <template v-else>
              The speed &amp; surface profile needs a ranked setup to simulate; it returns with the first match.
            </template>
          </p>
          <template v-else>
            <p
              v-if="refreshing"
              class="flex items-center gap-1.5 text-sm text-muted"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-4 animate-spin"
              />Updating results…
            </p>
            <div
              class="space-y-3 transition-opacity"
              :class="{ 'opacity-60 pointer-events-none': refreshing }"
            >
              <p class="text-xs text-muted">
                {{ speedScope }} The curve is this setup's simulated pace at every grade and surface change, over a faint elevation backdrop; the strip beneath marks the surface behind each dip.
              </p>
              <RouteSurfaceSpeedProfile
                :route="equipmentRoute"
                :frame="combo.frame"
                :wheelset="combo.wheelset"
                :weight-kg="rider.weightKg"
                :height-cm="rider.heightCm"
                :power-w="rider.powerW"
                :draft-mode="rider.draftMode"
                :ttt-riders="rider.tttRiders"
                :ttt-climb-wkg="rider.tttClimbWkg"
                flat
                :active="selected === 'speed'"
              />
            </div>
          </template>
        </div>
      </template>

      <template #surface>
        <div class="space-y-3">
          <p class="text-xs text-muted">
            {{ surfaceScope }}
          </p>
          <RouteSurfaceComposition
            v-if="route.surface.composition"
            :surface="route.surface"
            flat
          />
          <p
            v-else
            class="text-sm text-muted"
          >
            No detailed surface mix for this ride.
          </p>
        </div>
      </template>

      <template #plan>
        <div
          v-if="plan"
          class="space-y-3"
        >
          <p
            v-if="plan.coverage.withheld"
            class="text-sm text-muted"
          >
            {{ plan.coverage.withheld }}
          </p>
          <p
            v-else-if="!plan.hasSetup"
            class="text-sm text-muted"
          >
            <template v-if="plan.loading">
              The TTT plan follows the ranking.
            </template>
            <template v-else>
              The TTT plan needs a ranked setup to price its sectors; it returns with the first match.
            </template>
          </p>
          <template v-else>
            <p
              v-if="refreshing"
              class="flex items-center gap-1.5 text-sm text-muted"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-4 animate-spin"
              />Updating results…
            </p>
            <div
              class="space-y-3 transition-opacity"
              :class="{ 'opacity-60 pointer-events-none': refreshing }"
            >
              <p class="text-xs text-muted">
                {{ planScope }}
              </p>
              <p
                v-for="caveat in plan.coverage.caveats"
                :key="caveat"
                class="text-sm text-muted"
              >
                {{ caveat }}
              </p>
              <ul
                v-if="plan.sectors.length"
                aria-label="TTT sectors"
                class="divide-y divide-default"
              >
                <li
                  v-for="item in plan.sectors"
                  :key="`${item.type}-${item.fromKm}`"
                  class="flex items-start gap-3 py-3 text-sm"
                >
                  <UIcon
                    :name="PLAN_ICONS[item.type]"
                    class="mt-0.5 size-4 shrink-0"
                    :class="item.type === 'climb' ? 'text-success' : 'text-warning'"
                  />
                  <div>
                    <p class="font-medium text-highlighted">
                      km {{ item.fromKm.toFixed(1) }}–{{ item.toKm.toFixed(1) }}
                      <span class="font-normal text-muted">· {{ item.detail }}</span>
                    </p>
                    <p class="text-muted">
                      {{ item.note }}
                    </p>
                  </div>
                </li>
              </ul>
              <p
                v-else
                class="text-sm text-muted"
              >
                No sectors flagged by this model. Rides under {{ MIN_ROUTE_KM }} km, short surface stretches and low-cost surfaces are not flagged; this is not a guarantee of an uninterrupted paceline.
              </p>
            </div>
          </template>
        </div>
      </template>
    </UTabs>
  </section>
</template>
