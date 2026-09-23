<script setup lang="ts">
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import type { TttPlan } from '../composables/useTttPlan'
import type { AppliedRiderInputs } from '../utils/recommendRequest'
import { MIN_ROUTE_KM } from '#shared/utils/physics/racePlan'
import { draftOf } from '#shared/utils/physics/draft'
import { computeRouteSurfaceSpeedProfile } from '#shared/utils/physics/routeSurfaceSpeedProfile'
import { surfaceFamily } from '#shared/utils/silhouette'
import { courseNote, hasElevationProfile, hasSurfaceLocations } from '../utils/rankingResults'

/**
 * "The course": the tabs beside "Why this bike wins", under the answer. The
 * elevation profile is the Course hero at the top of the page and is not
 * drawn again here, so the tabs hold what the hero cannot say - the named
 * climbs and sprints in ride order (a route), the scoring segments (a race),
 * the surfaces as a table, and the equipment views (speed by surface, the
 * TTT plan), which describe one ranked setup and say so.
 *
 * Every panel is in the server HTML (`unmount-on-hide` off), so the segment
 * links exist before any interaction and a hidden panel is merely hidden.
 * Which tab shows is page memory (`useCourseAnalysisTab`), never the URL.
 *
 * Two Rides on purpose, not one. The Ride-only tabs follow the selector
 * (`route`, `laps`), like the Fact row and the hero: they describe the ride
 * the rider has chosen. The equipment views follow the APPLIED results
 * (`resultsRoute`, `resultsLaps`, `combo`, `rider`): a plan priced for a
 * setup must describe the ride and the rider that setup was ranked for, and
 * during a refresh they keep the previous results, dimmed, as the answer
 * does. `resultsRoute` is the Applied Ranking's own course on every page,
 * never the selected one standing in for it: on a race the category group
 * can move the course itself (#233). The TTT plan arrives from the page
 * (`useTttPlan`), which computes it once for the Fact row's TTT line and
 * this tab, so the two cannot disagree.
 */
const props = defineProps<{
  /** The route the rider has selected, or the synthetic segment-as-route the segment page ranks against. The Ride-only tabs describe this one. */
  route: RouteWithMeta
  /** The applied course - `appliedRanking.course` - which the equipment tabs describe. Absent until the ranking's own lookup has answered. */
  resultsRoute: RouteWithMeta | undefined
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
}>()

const { selected } = useCourseAnalysisTab()

const isRoute = computed(() => props.kind === 'route')
const leadInKm = computed(() => props.route.leadInDistance ?? 0)

// The applied course, for the two views that describe a ranked setup on it.
const equipmentLeadInKm = computed(() => props.resultsRoute?.leadInDistance ?? 0)
const equipmentHasElevation = computed(() => hasElevationProfile(props.resultsRoute))
const equipmentHasSurfaceLocations = computed(() => hasSurfaceLocations(props.resultsRoute))

const items = computed(() => [
  ...(isRoute.value ? [{ label: 'Climbs and sprints', value: 'segments' as const, slot: 'segments' as const }] : []),
  ...(props.scoring ? [{ label: 'Scoring', value: 'scoring' as const, slot: 'scoring' as const }] : []),
  { label: 'Surfaces', value: 'surface' as const, slot: 'surface' as const },
  ...(props.kind !== 'sprint' ? [{ label: 'Speed by surface', value: 'speed' as const, slot: 'speed' as const }] : []),
  ...(props.plan ? [{ label: 'TTT plan', value: 'plan' as const, slot: 'plan' as const }] : [])
])
// The remembered tab may have left the set: the plan when draft mode leaves
// ttt, the climbs on a segment page, the scoring of a race whose group has
// none. The first tab is always there.
watch(items, (list) => {
  if (!list.some(item => item.value === selected.value)) selected.value = list[0]!.value
}, { immediate: true })

const lapsLabel = (count: number) => `${count} lap${count === 1 ? '' : 's'}`

const segments = computed(() => isRoute.value ? courseSegmentsInRideOrder(props.route, props.laps) : [])

const segmentsScope = computed(() => leadInKm.value > 0
  ? `${lapsLabel(props.laps)}; kilometre positions include the lead-in, ridden once.`
  : `${lapsLabel(props.laps)}; kilometre positions are from the ride start.`)

const setupLabel = computed(() => props.combo
  ? `${props.combo.frame.name} / ${props.combo.wheelset?.name ?? 'fixed disc wheels'}`
  : undefined)
const equipmentCourseNote = computed(() => courseNote(props.route, props.resultsRoute))

// Always one lap - see `computeRouteSurfaceSpeedProfile` - while the finish
// estimate above is for every selected lap, so the scope says both.
const speedScope = computed(() => {
  const ride = !isRoute.value
    ? 'route-style simulation from a standing start, not the timed estimate'
    : props.resultsRoute?.lap
      ? `one lap${equipmentLeadInKm.value > 0 ? ' plus the lead-in' : ''}; the finish estimate covers ${lapsLabel(props.resultsLaps)}`
      : 'the whole ride'
  return `${setupLabel.value}${equipmentCourseNote.value} · ${props.rider.powerW} W · ${DRAFT_MODE_LABELS[props.rider.draftMode]} · ${ride}.`
})
const speedUnavailable = computed(() => {
  if (!props.resultsRoute) return 'Course data for the ranked setup is not available yet.'
  if (equipmentHasElevation.value && equipmentHasSurfaceLocations.value) return undefined
  const missing = !equipmentHasElevation.value && !equipmentHasSurfaceLocations.value
    ? 'elevation and surface locations are missing'
    : !equipmentHasElevation.value ? 'the elevation profile is missing' : 'surface locations are missing'
  return `Speed & surface profile unavailable: ${missing}. No curve is inferred from the overall surface mix.`
})

const surfaceScope = computed(() =>
  `${surfaceCoverageLine(props.route.surface)}; the shares describe ${isRoute.value ? 'one lap' : 'the timed segment'}.`)

/**
 * What each surface costs the fastest setup, in watts: the length-weighted
 * average of the speed profile's "extra power to hold this stretch's pace on
 * its real surface, against tarmac at the same pace". Equipment-dependent,
 * so from the APPLIED course and rank 1, and only when that course is the
 * one the table describes; worked out the first time the tab is shown,
 * client-side, because it is the same simulation the speed chart runs.
 */
const extraWatts = shallowRef<Partial<Record<string, number>>>()
function computeExtraWatts() {
  const route = props.resultsRoute
  const combo = props.combo
  if (!route || !combo || route.slug !== props.route.slug) {
    extraWatts.value = undefined
    return
  }
  const profile = computeRouteSurfaceSpeedProfile(route, combo.frame, combo.wheelset, props.rider.weightKg, props.rider.heightCm, props.rider.powerW,
    draftOf({ draftMode: props.rider.draftMode, tttRiders: props.rider.tttRiders, tttClimbWkg: props.rider.tttClimbWkg }))
  if (!profile) {
    extraWatts.value = undefined
    return
  }
  const totals: Record<string, { watts: number, km: number }> = {}
  for (const segment of profile.segments) {
    const km = segment.toKm - segment.fromKm
    const total = totals[segment.surface] ??= { watts: 0, km: 0 }
    total.watts += segment.extraWattsVsTarmac * km
    total.km += km
  }
  extraWatts.value = Object.fromEntries(Object.entries(totals).map(([surface, total]) => [surface, total.km > 0 ? Math.round(total.watts / total.km) : 0]))
}
onMounted(() => {
  watch([() => selected.value === 'surface', () => props.combo, () => props.resultsRoute, () => props.rider], ([shown]) => {
    if (shown) computeExtraWatts()
  }, { immediate: true })
})

/** The surface table's rows: each surface's share and distance on one lap (or the segment), largest first. */
const surfaceRows = computed(() => {
  const composition = props.route.surface.composition
  if (!composition) return []
  const lengthKm = props.route.distance
  return (Object.entries(composition) as [keyof typeof composition, number | undefined][])
    .filter((entry): entry is [keyof typeof composition, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([surface, percent]) => ({
      surface,
      family: surfaceFamily(surface),
      percent,
      distanceKm: (percent / 100) * lengthKm,
      extraWatts: extraWatts.value?.[surface]
    }))
})

const planScope = computed(() => {
  if (!props.plan) return undefined
  const ride = isRoute.value
    ? `${lapsLabel(props.resultsLaps)}${equipmentLeadInKm.value > 0 ? ', lead-in included once' : ''}; distances are from the ride start`
    : 'from the start of the timed segment; warm-up excluded'
  const team = `${props.plan.riders}-rider paceline${props.plan.climbWkg ? `, team climb pace ${props.plan.climbWkg.toFixed(1)} W/kg` : ''}`
  return `${setupLabel.value}${equipmentCourseNote.value} · ${props.rider.powerW} W · ${team} · ${ride}.`
})
</script>

<template>
  <section
    :id="COURSE_ANALYSIS_ID"
    aria-labelledby="course-analysis-heading"
    tabindex="-1"
    class="min-w-0 scroll-mt-24 outline-none"
  >
    <h2
      id="course-analysis-heading"
      class="text-2xl font-semibold font-heading text-highlighted"
    >
      The course
    </h2>
    <!-- The list wraps rather than scrolls so every tab is visible on a phone;
         the sliding indicator only knows one row, so the active trigger draws
         its own underline, in the primary like the current section. -->
    <UTabs
      v-model="selected"
      :items="items"
      variant="link"
      color="neutral"
      :unmount-on-hide="false"
      class="mt-3"
      :ui="{
        list: 'flex-wrap gap-x-1 border-b border-accented',
        indicator: 'hidden',
        trigger: 'text-md text-muted data-[state=active]:text-highlighted data-[state=active]:after:content-[\'\'] data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary',
        content: 'pt-3'
      }"
    >
      <!-- Ride-only, and the page's own: where the points are is a property
           of the race's rules, not of anything that was ranked. -->
      <template #scoring>
        <slot name="scoring" />
      </template>

      <template #segments>
        <p class="text-xs text-muted">
          {{ segmentsScope }}
        </p>
        <ol
          v-if="segments.length"
          aria-label="Segments in ride order"
          class="mt-1"
        >
          <li
            v-for="(segment, index) in segments"
            :key="`${segment.slug}-${segment.rideFromKm}-${index}`"
            class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-default py-3"
          >
            <div class="min-w-0">
              <NuxtLink
                :to="`/segments/${segment.slug}`"
                class="font-semibold text-highlighted hover:underline"
              >Fastest bike for {{ segment.name }}</NuxtLink>
              <p class="text-sm text-muted">
                {{ segment.kind === 'climb' ? 'Climb' : 'Sprint' }}{{ segment.climbType ? `, ${segment.climbType === 'HC' ? 'HC' : `category ${segment.climbType}`}` : '' }} · km {{ segment.rideFromKm.toFixed(1) }} to {{ segment.rideToKm.toFixed(1) }}<template v-if="segment.lapNumber">
                  · lap {{ segment.lapNumber }}
                </template><template v-else-if="segment.leadIn">
                  · lead-in
                </template>
              </p>
            </div>
            <p class="text-right text-md whitespace-nowrap">
              {{ formatDistance(segment.lengthKm) }} · {{ segment.avgGradePercent ? formatGrade(segment.avgGradePercent) : 'flat' }}
              <span
                v-if="segment.elevationM !== undefined"
                class="block text-xs text-muted"
              >{{ formatElevation(segment.elevationM) }}</span>
            </p>
          </li>
        </ol>
        <p
          v-else
          class="mt-2 text-sm text-muted"
        >
          No mapped climbs or sprints on this route.
        </p>
      </template>

      <template #surface>
        <p class="text-xs text-muted">
          {{ surfaceScope }}
        </p>
        <table
          v-if="surfaceRows.length"
          class="mt-1 w-full border-collapse text-md"
          aria-label="Surfaces"
        >
          <thead>
            <tr class="text-left text-xs text-muted">
              <th
                scope="col"
                class="border-b border-default px-2 py-2 font-medium"
              >
                Surface
              </th>
              <th
                scope="col"
                class="border-b border-default px-2 py-2 text-right font-medium"
              >
                Share
              </th>
              <th
                scope="col"
                class="border-b border-default px-2 py-2 text-right font-medium"
              >
                Distance
              </th>
              <th
                scope="col"
                class="border-b border-default px-2 py-2 text-right font-medium"
              >
                Extra watts
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in surfaceRows"
              :key="row.surface"
            >
              <td class="border-b border-default px-2 py-2.5">
                <span
                  class="mr-2 inline-block size-2.5 rounded-[2px] align-[-1px]"
                  :class="SURFACE_FAMILY_BG[row.family]"
                  aria-hidden="true"
                />{{ SURFACE_TYPE_LABELS[row.surface] }}
              </td>
              <td class="border-b border-default px-2 py-2.5 text-right">
                {{ formatPercent(row.percent) }}
              </td>
              <td class="border-b border-default px-2 py-2.5 text-right">
                {{ formatDistance(row.distanceKm) }}
              </td>
              <td class="border-b border-default px-2 py-2.5 text-right">
                {{ row.surface === 'tarmac' || row.extraWatts === undefined ? '-' : `+${row.extraWatts} W` }}
              </td>
            </tr>
          </tbody>
        </table>
        <p
          v-else
          class="mt-2 text-sm text-muted"
        >
          No detailed surface mix for this ride.
        </p>
        <p
          v-if="surfaceRows.length"
          class="mt-2 text-xs text-muted"
        >
          Extra watts are what the fastest setup needs to hold its pace on each surface rather than on tarmac, averaged over the ride<template v-if="!extraWatts">
            - they appear once a ranked setup and mapped surface positions are there to simulate
          </template>.
        </p>
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
              The speed by surface follows the ranking.
            </template>
            <template v-else>
              Speed by surface needs a ranked setup to simulate; it returns with the first match.
            </template>
          </p>
          <!-- The course is there whenever `speedUnavailable` is not; the
               condition only tells the type checker what the line above already
               said. -->
          <template v-else-if="resultsRoute">
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
                {{ speedScope }} The line is this setup's simulated pace at every grade and surface change, over a faint elevation backdrop; the strip beneath marks the surface behind each dip.
              </p>
              <RouteSurfaceSpeedProfile
                :route="resultsRoute"
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
              >
                <li
                  v-for="item in plan.sectors"
                  :key="`${item.type}-${item.fromKm}`"
                  class="border-b border-default py-3 text-md"
                >
                  <p class="font-semibold text-highlighted">
                    km {{ item.fromKm.toFixed(1) }} to {{ item.toKm.toFixed(1) }}
                    <span class="font-normal text-muted">· {{ item.type === 'climb' ? 'sustained climb' : 'rough surface' }} · {{ item.detail }}</span>
                  </p>
                  <p class="text-sm text-toned">
                    {{ item.note }}
                  </p>
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
