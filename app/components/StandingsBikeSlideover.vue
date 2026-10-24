<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'
import type { ClassifiedBikeFrame } from '../../shared/types/catalog'
import { BIKE_STYLE_LABELS } from '../utils/labels'
import { formatGapSeconds, formatMargin, formatMeanGap, secondsPerHour } from '../utils/standings'
import { upgradeGains } from '../utils/upgradeCurve'
import { stageSteps, stageUpgrades } from '../utils/upgradeStages'

// Mounted once in `app.vue` beside the other drawers and opened through
// `useOverlays().openStandingsBike` from a Bikes standings row's name. What
// the row already knows (its place, its gaps by terrain, its closest and
// furthest routes) arrives in the record; the frame itself - upgrade curve
// and scheme, ratings, fixed wheels - is fetched once the drawer opens, so
// the page does not carry it for every row.
defineProps<{ content?: SlideoverProps['content'] }>()
const open = defineModel<boolean>('open', { default: false })
const { standingsBike, closeOverlays } = useOverlays()

// A link in an Overlay takes the rider off it: see `StandingsWinsSlideover`.
const route = useRoute()
watch(() => route.path, () => {
  if (open.value) closeOverlays()
})

// Every standing is timed at the last stage, so that is the one marked on the curves.
const STANDINGS_STAGE = 5

const frame = ref<ClassifiedBikeFrame>()
const failed = ref(false)
let token = 0
async function loadFrame() {
  const record = standingsBike.value
  if (!record) return
  const mine = ++token
  frame.value = undefined
  failed.value = false
  try {
    const loaded = await $fetch<ClassifiedBikeFrame>(`/api/bikes/${record.frameId}`)
    if (mine === token) frame.value = loaded
  } catch {
    if (mine === token) failed.value = true
  }
}
watch([open, standingsBike], ([isOpen]) => {
  if (isOpen) loadFrame()
}, { immediate: true })

const { owned, load: loadGarage, setOwned } = useGarage()
const { defaultUnownedLevel } = useRiderProfile()
watch(open, (isOpen) => {
  if (isOpen) loadGarage()
}, { immediate: true })
const ownedLevel = computed(() => frame.value ? owned.value[frame.value.id] : undefined)
const isOwned = computed(() => ownedLevel.value !== undefined)

const routesLabel = (count: number) => `${count} ${count === 1 ? 'route' : 'routes'}`
// A gap that rounds to nothing but is not nothing is not "0.00%": that is
// what the drawer says only where the bike loses nothing at all.
const gapText = (pct: number) => formatMeanGap(pct) === '0.00%' && pct > 0 ? '<0.01%' : formatMeanGap(pct)

// Said by the sign of the seconds, not by where the bike is ranked: the
// ranking goes by share, so a neighbour can be a little slower in seconds
// than the bike ranked behind it.
const neighbourSeconds = (seconds: number) => Math.abs(seconds) < 0.05
  ? 'about the same on average'
  : `${formatGapSeconds(Math.abs(seconds))} ${seconds < 0 ? 'faster' : 'slower'} on average`

const UPGRADE_AXIS_LABELS = { distance: 'distance', duration: 'duration', elevation: 'elevation' } as const
const UPGRADE_TIER_LABELS = { entry: 'entry-level', mid: 'mid-range', high: 'high-end' } as const

const upgrade = computed(() => {
  const current = frame.value
  if (!current?.upgradeCurve) return undefined
  const flat = upgradeGains(current.upgradeCurve.flat)
  const climb = upgradeGains(current.upgradeCurve.climb)
  const upgrades = current.upgradeScheme ? stageUpgrades(current.upgradeScheme) : undefined
  const flatSteps = stageSteps(flat)
  const climbSteps = stageSteps(climb)
  return {
    stages: flatSteps.map((step, index) => ({ stage: index + 1, upgrades: upgrades?.[index], flat: step, climb: climbSteps[index] ?? 0 })),
    totalFlat: flat.at(-1) ?? 0,
    totalClimb: climb.at(-1) ?? 0
  }
})

const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`
const RATINGS = [
  { key: 'aero', label: 'Aero (flat/fast)' },
  { key: 'climb', label: 'Climbing' },
  { key: 'gravel', label: 'Gravel' },
  { key: 'cobble', label: 'Cobbles' }
] as const
</script>

<template>
  <USlideover
    v-model:open="open"
    :content="content"
    side="right"
    :title="standingsBike?.name ?? 'Bike'"
    :description="standingsBike ? `Rank ${standingsBike.rank} of ${standingsBike.ranked} over ${routesLabel(standingsBike.routeCount)}` : undefined"
    :ui="{ content: 'sm:max-w-xl', title: 'text-xl font-semibold font-heading', description: 'text-toned' }"
  >
    <template #body>
      <div
        v-if="standingsBike"
        class="space-y-6"
      >
        <section class="space-y-2">
          <h3 class="text-lg font-semibold font-heading text-highlighted">
            In the standings
          </h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-md">
            <dt class="text-muted">
              Mean gap to the fastest
            </dt>
            <dd class="text-xl font-semibold font-heading text-highlighted">
              {{ standingsBike.meanGapSec === 0 ? 'Fastest on every route' : gapText(standingsBike.meanGapPct) }}
              <span
                v-if="standingsBike.meanGapSec !== 0"
                class="block text-sm font-normal text-muted"
              >{{ formatGapSeconds(standingsBike.meanGapSec) }} on average · ≈ {{ secondsPerHour(standingsBike.meanGapPct) }} s per hour</span>
            </dd>
            <dt class="text-muted">
              Fastest on
            </dt>
            <dd class="text-highlighted">
              {{ standingsBike.wins }} of {{ routesLabel(standingsBike.routeCount) }}
            </dd>
            <template
              v-for="near in [
                { key: 'ahead', label: 'Just ahead', other: standingsBike.ahead },
                { key: 'behind', label: 'Just behind', other: standingsBike.behind }
              ].filter(near => near.other)"
              :key="near.key"
            >
              <dt class="text-muted">
                {{ near.label }}
              </dt>
              <dd class="text-highlighted break-words">
                {{ near.other!.name }}
                <span class="block text-sm text-muted">{{ gapText(near.other!.gapPct).replace('+', '') }} apart · {{ neighbourSeconds(near.other!.gapSec) }}</span>
              </dd>
            </template>
          </dl>
          <p class="text-xs text-muted">
            Over the routes your filters leave, timed on its own fastest wheels at upgrade stage 5 for the default rider. The bikes are ranked by the percentage, which weighs every route alike; the seconds are the plain average over routes of different lengths.
          </p>
        </section>

        <section
          v-if="standingsBike.terrain.length"
          class="space-y-2"
        >
          <h3 class="text-lg font-semibold font-heading text-highlighted">
            By terrain
          </h3>
          <table class="w-full border-collapse text-md">
            <caption class="sr-only">
              Mean gap to the fastest by route terrain
            </caption>
            <thead>
              <tr class="border-b border-accented text-left text-xs text-muted">
                <th
                  scope="col"
                  class="px-1 py-2 font-medium"
                >
                  Terrain
                </th>
                <th
                  scope="col"
                  class="px-1 py-2 text-right font-medium"
                >
                  Routes
                </th>
                <th
                  scope="col"
                  class="px-1 py-2 text-right font-medium"
                >
                  Mean gap
                </th>
                <th
                  scope="col"
                  class="px-1 py-2 text-right font-medium"
                >
                  Seconds
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in standingsBike.terrain"
                :key="row.label"
                class="border-b border-default"
              >
                <td class="px-1 py-2">
                  {{ row.label }}
                </td>
                <td class="px-1 py-2 text-right text-muted">
                  {{ row.routeCount }}
                </td>
                <td class="px-1 py-2 text-right font-semibold text-highlighted">
                  {{ row.meanGapSec === 0 ? 'Fastest' : gapText(row.meanGapPct) }}
                </td>
                <td class="px-1 py-2 text-right text-muted tabular-nums">
                  {{ row.meanGapSec === 0 ? '–' : formatGapSeconds(row.meanGapSec) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section
          v-for="group in [
            { key: 'closest', heading: standingsBike.marginAgainst ? 'Closest to the runner-up' : 'Closest to the fastest', routes: standingsBike.closest },
            { key: 'furthest', heading: standingsBike.marginAgainst ? 'Furthest from the runner-up' : 'Furthest from the fastest', routes: standingsBike.furthest }
          ].filter(group => group.routes.length)"
          :key="group.key"
          class="space-y-2"
        >
          <h3 class="text-lg font-semibold font-heading text-highlighted">
            {{ group.heading }}
          </h3>
          <p
            v-if="standingsBike.marginAgainst"
            class="text-xs text-muted"
          >
            This is the fastest bike, so these are its margins to the runner-up, {{ standingsBike.marginAgainst }}.
          </p>
          <ul
            :aria-label="group.heading"
            class="divide-y divide-default border-y border-default"
          >
            <li
              v-for="gapRoute in group.routes"
              :key="gapRoute.slug"
            >
              <NuxtLink
                :to="`/routes/${gapRoute.slug}${standingsBike.linkQuery}`"
                class="flex items-baseline justify-between gap-3 px-1 py-2.5 hover:text-primary"
              >
                <span class="min-w-0">
                  <span class="block font-medium text-highlighted break-words">{{ gapRoute.name }}</span>
                  <span class="block text-xs text-muted">{{ gapRoute.worldName }} · {{ gapRoute.terrainLabel }}</span>
                </span>
                <span class="shrink-0 text-right">
                  <span class="block font-semibold text-highlighted">{{ standingsBike.marginAgainst ? formatMargin(gapRoute.gapPct) : gapRoute.gapSec === 0 ? 'Fastest' : gapText(gapRoute.gapPct) }}</span>
                  <span
                    v-if="standingsBike.marginAgainst || gapRoute.gapSec !== 0"
                    class="block text-xs text-muted tabular-nums"
                  >{{ formatGapSeconds(standingsBike.marginAgainst ? Math.abs(gapRoute.gapSec) : gapRoute.gapSec) }}</span>
                </span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <p
          v-if="failed"
          class="text-sm text-muted"
        >
          This bike's details could not be loaded.
          <button
            type="button"
            class="underline decoration-rule-strong hover:text-highlighted"
            @click="loadFrame"
          >
            Try again
          </button>
        </p>
        <div
          v-else-if="!frame"
          class="space-y-3"
          aria-busy="true"
        >
          <USkeleton class="h-6 w-2/3" />
          <USkeleton class="h-24 w-full" />
        </div>

        <template v-else>
          <section class="space-y-3">
            <h3 class="text-lg font-semibold font-heading text-highlighted">
              The frame
            </h3>
            <p class="text-md text-toned">
              {{ BIKE_CATEGORY_LABELS[frame.category] }}<template v-if="frame.style">
                · {{ BIKE_STYLE_LABELS[frame.style] }} frame
              </template>
            </p>
            <p
              class="text-sm"
              :class="frame.confidence === 'measured' ? 'text-success' : 'text-warning'"
            >
              {{ frame.confidence === 'measured' ? 'Bot-tested' : 'Estimated' }}
            </p>
            <p
              v-if="frame.hasFixedWheels"
              class="text-sm text-muted"
            >
              Comes with its own integrated wheels, which cannot be swapped in Zwift - so it is timed on those.
            </p>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-md sm:grid-cols-4">
              <div
                v-for="rating in RATINGS"
                :key="rating.key"
              >
                <dt class="text-xs text-muted">
                  {{ rating.label }}
                </dt>
                <dd class="font-semibold text-highlighted">
                  {{ frame.scores[rating.key] }}<span class="text-xs font-normal text-muted"> / 100</span>
                </dd>
              </div>
            </dl>
            <div class="flex flex-wrap items-center gap-3">
              <UButton
                size="sm"
                color="neutral"
                variant="outline"
                :icon="isOwned ? 'i-lucide-check' : 'i-lucide-plus'"
                @click="setOwned(frame.id, isOwned ? null : defaultUnownedLevel)"
              >
                {{ isOwned ? 'Frame in your garage' : 'Add frame to garage' }}
              </UButton>
            </div>
            <div
              v-if="isOwned && frame.confidence === 'measured'"
              class="flex flex-wrap items-center gap-2 text-sm"
            >
              <span class="text-muted">Your upgrade stage</span>
              <div class="flex items-center gap-0.5">
                <button
                  v-for="level in [0, 1, 2, 3, 4, 5]"
                  :key="level"
                  type="button"
                  class="flex size-7 items-center justify-center rounded text-xs font-medium transition-colors"
                  :class="level === ownedLevel ? 'bg-inverted text-inverted' : 'bg-accented text-toned hover:text-highlighted'"
                  :aria-label="`Set upgrade stage ${level} for ${frame.name}`"
                  :aria-pressed="level === ownedLevel"
                  @click="setOwned(frame.id, level)"
                >
                  {{ level }}
                </button>
              </div>
            </div>
            <p class="text-xs text-muted">
              The standings time every bike at stage 5. Your own stage applies on each route's page.
            </p>
          </section>

          <section
            v-if="frame.upgradeCurve && upgrade"
            class="space-y-3"
          >
            <h3 class="text-lg font-semibold font-heading text-highlighted">
              What upgrading does
            </h3>
            <div class="grid grid-cols-2 gap-4">
              <UpgradeSparkline
                :values="frame.upgradeCurve.flat"
                :level="STANDINGS_STAGE"
                label="Flat"
              />
              <UpgradeSparkline
                :values="frame.upgradeCurve.climb"
                :level="STANDINGS_STAGE"
                label="Climb"
              />
            </div>
            <p class="text-sm text-toned">
              Fully upgraded it saves {{ upgrade.totalFlat.toFixed(1) }} s per hour on the flat and {{ upgrade.totalClimb.toFixed(1) }} s per hour on a climb, over the just-bought bike.<template v-if="frame.upgradeScheme">
                A {{ UPGRADE_TIER_LABELS[frame.upgradeScheme.tier] }} frame, stages earned by {{ UPGRADE_AXIS_LABELS[frame.upgradeScheme.axis] }}.
              </template>
            </p>
            <table class="w-full border-collapse text-md">
              <caption class="sr-only">
                What each upgrade stage adds, in seconds per hour
              </caption>
              <thead>
                <tr class="border-b border-accented text-left text-xs text-muted">
                  <th
                    scope="col"
                    class="px-1 py-2 font-medium"
                  >
                    Stage
                  </th>
                  <th
                    v-if="frame.upgradeScheme"
                    scope="col"
                    class="px-1 py-2 font-medium"
                  >
                    Upgrades
                  </th>
                  <th
                    scope="col"
                    class="px-1 py-2 text-right font-medium"
                  >
                    Flat
                  </th>
                  <th
                    scope="col"
                    class="px-1 py-2 text-right font-medium"
                  >
                    Climb
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="step in upgrade.stages"
                  :key="step.stage"
                  class="border-b border-default"
                >
                  <td class="px-1 py-2">
                    {{ step.stage }}
                  </td>
                  <td
                    v-if="frame.upgradeScheme"
                    class="px-1 py-2"
                  >
                    {{ step.upgrades }}
                  </td>
                  <td class="px-1 py-2 text-right tabular-nums">
                    {{ signed(step.flat) }}
                  </td>
                  <td class="px-1 py-2 text-right tabular-nums">
                    {{ signed(step.climb) }}
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="text-xs text-muted">
              Seconds saved per hour at each stage, from ZwiftInsider's bot tests at 300 W (flat: Tempus Fugit, climb: Alpe du Zwift). Each stage upgrades one thing, so an aero stage barely shows uphill and a weight stage barely on the flat.
            </p>
          </section>
          <p
            v-else
            class="text-sm text-muted"
          >
            ZwiftInsider has no per-stage bot tests for this frame, so upgrading it changes nothing here.
          </p>
        </template>
      </div>
    </template>
  </USlideover>
</template>
