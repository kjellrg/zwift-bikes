<script setup lang="ts">
import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from '../../shared/types/catalog'
import { buildRacePlan } from '#shared/utils/physics/racePlan'
import { geometryForRouteLaps } from '#shared/utils/physics/routeGeometry'

const props = defineProps<{
  route: RouteWithMeta
  laps: number
  weightKg: number
  heightCm: number
  powerW: number
  /** The combo the surface watt-costs are quoted for - the same one the speed/surface chart profiles. */
  frame: ClassifiedBikeFrame
  wheelset?: Wheelset
  tttRiders?: number
  tttClimbWkg?: number
}>()

// Pure closed-form (no simulation - see `buildRacePlan`), cheap enough to
// compute eagerly. Empty for short events (<5 km), which also hides the card.
const items = computed(() => buildRacePlan(geometryForRouteLaps(props.route, props.laps), {
  weightKg: props.weightKg,
  heightCm: props.heightCm,
  riderPowerW: props.powerW,
  climbWkg: props.tttClimbWkg,
  riders: props.tttRiders,
  frame: props.frame,
  wheelset: props.wheelset
}))

const ITEM_ICONS: Record<string, string> = {
  climb: 'i-lucide-mountain',
  surface: 'i-lucide-triangle-alert'
}
</script>

<template>
  <UCard v-if="items.length">
    <UCollapsible :ui="{ content: 'mt-3' }">
      <template #default="{ open }">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left"
        >
          <span class="flex items-center gap-2">
            <p class="font-semibold text-highlighted">
              Race plan
            </p>
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ items.length }} danger{{ items.length === 1 ? "" : "s" }}
            </UBadge>
            <UTooltip text="Stretches of this route that can break up or slow a TTT paceline: long climbs (draft gives almost nothing at climbing speeds) and sustained rough-surface sectors. The watt figure is what the surface costs you on top of holding the same pace on tarmac, for the fastest combo below - the same calculation the speed &amp; surface effort panel uses. Short stretches, and surfaces that cost nothing (sand rolls exactly like tarmac in Zwift), are left out.">
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
        <div class="space-y-3">
          <div
            v-for="item in items"
            :key="`${item.type}-${item.fromKm}`"
            class="flex items-start gap-3 text-sm"
          >
            <UIcon
              :name="ITEM_ICONS[item.type] ?? 'i-lucide-flag'"
              class="size-4 mt-0.5 shrink-0"
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
          </div>
        </div>
      </template>
    </UCollapsible>
  </UCard>
</template>
