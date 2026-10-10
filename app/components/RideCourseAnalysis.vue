<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'
import type { RecommendRide } from '../../shared/types/recommendRide'
import type { CourseAnalysisTab } from '../composables/useCourseAnalysisTab'
import type { TttPlan } from '../composables/useTttPlan'
import type { AppliedRiderInputs } from '../utils/recommendRequest'
import { MIN_ROUTE_KM } from '#shared/utils/physics/racePlan'
import { draftOf } from '#shared/utils/physics/draft'
import { surfaceFamily } from '#shared/utils/silhouette'

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
 * One Ride: the Applied one, resolved (`ride`). The equipment views must
 * describe the ride and the rider their setup was ranked for, and during a
 * refresh they keep the previous results, dimmed, as the answer does. The
 * course tabs (climbs and sprints, surfaces) are Ride-only information, but
 * they read the Applied Ride, not the selected one the Course hero above
 * draws: the whole section follows the Applied Ranking and waits for a
 * refreshed one rather than describing a course the times on screen were not
 * computed over. It is the Applied Ranking's own course on every page,
 * never the selected one standing in for it: on a race the category group
 * can move the course itself (#233). The TTT plan arrives from the page
 * (`useTttPlan`), which computes it once for the Fact row's TTT line and
 * this tab, so the two cannot disagree.
 */
const props = defineProps<{
  /** The Applied Ride, resolved - `resolveRankingPageRide` over the Applied Ranking's course. Every tab describes this one. */
  ride: RecommendRide
  /** What the page ranks: a route gets the Segments tab; a sprint has no speed chart. */
  kind: 'route' | 'climb' | 'sprint'
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
const route = computed(() => props.ride.route)
const laps = computed(() => props.ride.laps)
const leadInKm = computed(() => route.value.leadInDistance ?? 0)
const measuredLap = computed(() => props.ride.coverage.measuredLap)
const positionedSurfaces = computed(() => props.ride.coverage.positionedSurfaces)

const items = computed(() => [
  ...(isRoute.value ? [{ label: 'Climbs and sprints', value: 'segments' as const, slot: 'segments' as const }] : []),
  ...(props.scoring ? [{ label: 'Scoring', value: 'scoring' as const, slot: 'scoring' as const }] : []),
  { label: 'Surfaces', value: 'surface' as const, slot: 'surface' as const },
  ...(props.kind !== 'sprint' ? [{ label: 'Speed by surface', value: 'speed' as const, slot: 'speed' as const }] : []),
  ...(props.plan ? [{ label: 'TTT plan', value: 'plan' as const, slot: 'plan' as const }] : [])
])
// The remembered tab may have left the set: the plan when draft mode leaves
// ttt, the climbs on a segment page, the scoring of a race whose group has
// none. The first tab is always there, and it is shown in place of the
// remembered one without being written back - a segment page would
// otherwise overwrite the rider's route tab with Surfaces for the next
// route page.
const shown = computed<CourseAnalysisTab>({
  get: () => items.value.some(item => item.value === selected.value) ? selected.value : items.value[0]!.value,
  set: (tab) => {
    selected.value = tab
  }
})

const lapsLabel = (count: number) => `${count} lap${count === 1 ? '' : 's'}`

const segments = computed(() => isRoute.value ? courseSegmentsInRideOrder(props.ride) : [])

const segmentsScope = computed(() => leadInKm.value > 0
  ? `${lapsLabel(laps.value)}; kilometre positions include the lead-in, ridden once.`
  : `${lapsLabel(laps.value)}; kilometre positions are from the ride start.`)

const setupLabel = computed(() => props.combo
  ? `${props.combo.frame.name} / ${props.combo.wheelset?.name ?? 'fixed disc wheels'}`
  : undefined)

// A route's chart is one pass of the lap with the lead-in - see
// `RecommendRide.speedProfile` - while the finish estimate above is for every
// selected lap, so the scope says both. A segment's is the timed estimate's
// own simulation, entered at speed off the warm-up.
const speedScope = computed(() => {
  const ride = !isRoute.value
    ? 'the timed segment, entered at racing speed as the finish estimate is'
    : route.value.lap
      ? `one lap${leadInKm.value > 0 ? ' plus the lead-in' : ''}; the finish estimate covers ${lapsLabel(laps.value)}`
      : 'the whole ride'
  return `${setupLabel.value} · ${props.rider.powerW} W · ${DRAFT_MODE_LABELS[props.rider.draftMode]} · ${ride}.`
})
const speedUnavailable = computed(() => {
  if (measuredLap.value && positionedSurfaces.value) return undefined
  const missing = !measuredLap.value && !positionedSurfaces.value
    ? 'elevation and surface locations are missing'
    : !measuredLap.value ? 'the elevation profile is missing' : 'surface locations are missing'
  return `Speed & surface profile unavailable: ${missing}. No curve is inferred from the overall surface mix.`
})

const surfaceScope = computed(() =>
  `${surfaceCoverageLine(route.value.surface)}; the shares describe ${isRoute.value ? 'one lap' : 'the timed segment'}.`)

/**
 * Rank 1's speed profile on the Applied Ride: the speed chart draws it and
 * the Surfaces tab's extra watts are read off it - what each surface costs
 * the fastest setup, the length-weighted average of "extra power to hold
 * this stretch's pace on its real surface, against tarmac at the same pace".
 * One simulation for both, worked out the first time either tab is shown and
 * never in the server render: the tab state a server render sees never
 * selects either panel, and a simulation there would put the whole curve
 * into every page's HTML.
 */
const speedOpened = ref(false)
const speedComputing = ref(false)
onMounted(() => {
  watch(() => shown.value === 'speed' || shown.value === 'surface', async (open) => {
    if (!open || speedOpened.value) return
    speedComputing.value = true
    await nextTick() // let the spinner paint before the synchronous simulation blocks the main thread
    speedOpened.value = true
    speedComputing.value = false
  }, { immediate: true })
})
const speedProfile = computed(() => {
  const combo = props.combo
  if (!speedOpened.value || !combo || speedUnavailable.value) return undefined
  return props.ride.speedProfile(combo, props.rider, draftOf(props.rider))
})
const extraWatts = computed(() => speedProfile.value?.extraWattsBySurface)

/** The surface table's rows: each surface's share and distance on one lap (or the segment), largest first. */
const surfaceRows = computed(() => {
  const composition = route.value.surface.composition
  if (!composition) return []
  const lengthKm = route.value.distance
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
    ? `${lapsLabel(laps.value)}${leadInKm.value > 0 ? ', lead-in included once' : ''}; distances are from the ride start`
    : 'from the start of the timed segment; warm-up excluded'
  const team = `${props.plan.riders}-rider paceline${props.plan.climbWkg ? `, team climb pace ${props.plan.climbWkg.toFixed(1)} W/kg` : ''}`
  return `${setupLabel.value} · ${props.rider.powerW} W · ${team} · ${ride}.`
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
         its own underline, in the primary like the current section. A step
         smaller and tighter on a phone, so a route's three tabs fit one row
         and only a race's longer set wraps. -->
    <UTabs
      v-model="shown"
      :items="items"
      variant="link"
      color="neutral"
      :unmount-on-hide="false"
      class="mt-3"
      :ui="{
        list: 'flex-wrap gap-x-1 border-b border-accented',
        indicator: 'hidden',
        trigger: 'text-md text-muted max-sm:px-2 max-sm:text-sm data-[state=active]:text-highlighted data-[state=active]:after:content-[\'\'] data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary',
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
                {{ speedScope }} The line is this setup's simulated pace at every grade and surface change, over a faint elevation backdrop; the strip beneath marks the surface behind each dip.
              </p>
              <RouteSurfaceSpeedProfile
                :profile="speedProfile"
                :computing="speedComputing"
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
