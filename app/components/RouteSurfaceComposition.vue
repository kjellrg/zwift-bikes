<script setup lang="ts">
import type { SurfaceEstimate, ZwiftSurfaceType } from '../../shared/types/catalog'
import { SURFACE_CRR } from '#shared/data/surfaceCrr'

const props = defineProps<{
  surface: SurfaceEstimate
}>()

// Only `'measured'`/`'curated'` routes carry a detailed composition - see
// `estimateSurface` in `routeTerrain.ts`. Unverified/heuristic routes don't
// have real surface data to show here.
const rows = computed(() => {
  const composition = props.surface.composition
  if (!composition) return []
  return (Object.entries(composition) as [ZwiftSurfaceType, number | undefined][])
    .filter(([, percent]) => (percent ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([surfaceType, percent]) => ({
      surfaceType,
      percent: percent ?? 0,
      crr: SURFACE_CRR[surfaceType]
    }))
})

const tooltipText = computed(() =>
  props.surface.confidence === 'measured'
    ? 'Measured from this route\'s real GPS trace, with Zwift\'s rolling-resistance (Crr) value per surface and wheel type - a higher Crr means more effort to hold the same speed. See THIRD_PARTY_NOTICES.md for the data source.'
    : 'Best-effort surface mix for this route, with Zwift\'s rolling-resistance (Crr) value per surface and wheel type - a higher Crr means more effort to hold the same speed. See THIRD_PARTY_NOTICES.md for the data source.'
)
</script>

<template>
  <!-- Collapsed by default, and the same way on every page that shows it. The
       per-surface Crr table is expert detail: the route and race headers
       already carry `SurfaceBadges` for the at-a-glance mix, and where the
       surface is actually the story (a fully cobbled race) the page says so in
       prose above. Same UCard + UCollapsible header button as
       `RouteElevationProfile`, so the analysis cards behave alike. -->
  <UCard v-if="rows.length">
    <UCollapsible :ui="{ content: 'mt-3' }">
      <template #default="{ open }">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left"
        >
          <span class="flex items-center gap-2">
            <p class="font-semibold text-highlighted">
              Surface composition
            </p>
            <UTooltip :text="tooltipText">
              <UIcon
                name="i-lucide-info"
                class="size-4 text-muted"
                @click.stop
              />
            </UTooltip>
          </span>
          <UIcon
            :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="size-4 text-muted shrink-0"
          />
        </button>
      </template>

      <template #content>
        <div class="flex h-2 w-full overflow-hidden rounded-full bg-elevated">
          <div
            v-for="row in rows"
            :key="row.surfaceType"
            :class="SURFACE_TYPE_COLORS[row.surfaceType]"
            :style="{ width: `${row.percent}%` }"
          />
        </div>

        <div class="mt-4 space-y-2">
          <div
            v-for="row in rows"
            :key="row.surfaceType"
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm"
          >
            <span class="inline-flex items-center gap-1.5 font-medium">
              <span
                class="size-2 rounded-full inline-block"
                :class="SURFACE_TYPE_COLORS[row.surfaceType]"
              />
              <UIcon
                :name="SURFACE_TYPE_ICONS[row.surfaceType]"
                class="size-3.5 text-muted"
              />
              {{ SURFACE_TYPE_LABELS[row.surfaceType] }}
              <span class="text-muted font-normal">~{{ formatPercent(row.percent) }}</span>
            </span>
            <span class="flex gap-x-3 text-xs text-muted">
              <span v-if="row.crr.road !== null">Road Crr {{ row.crr.road.toFixed(4) }}</span>
              <span v-if="row.crr.gravel !== null">Gravel Crr {{ row.crr.gravel.toFixed(4) }}</span>
              <span v-if="row.crr.mountain !== null">MTB Crr {{ row.crr.mountain.toFixed(4) }}</span>
            </span>
          </div>
        </div>
      </template>
    </UCollapsible>
  </UCard>
</template>
