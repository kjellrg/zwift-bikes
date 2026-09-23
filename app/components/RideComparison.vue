<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'
import { comboPhysicsDelta, formatSignedDelta } from '../utils/rankingResults'

/**
 * Up to three picked setups side by side, as a table in the Ranking's own
 * terms: a column per setup, a row per number - time, gap to the fastest on
 * the page, the physics against the stock bike, where the numbers come from,
 * the stage and the terrain fit. Comparing reads like ranking.
 *
 * Renders nothing until something is picked, and lives in the page's flow
 * (not a floating panel) so it reads with the ranking it was picked from and
 * never covers it on a phone - the "Show comparison" control jumps here
 * instead (`showComparison`), which is why the section takes focus. On a
 * narrow screen the table scrolls inside its own container, never the page.
 */
const props = defineProps<{
  /** The picked combos, in pick order. */
  combos: ComboScore[]
  fastestTimeSec?: number
}>()

defineEmits<{ clear: [], remove: [key: string] }>()

const dataLabel = (confidence: 'measured' | 'estimated' | string) => confidence === 'measured' ? 'Bot-tested' : 'Estimated'

/** One row of the table: its label and each setup's value, with an optional status colour. */
const rows = computed(() => props.combos.length
  ? [
      {
        label: 'Gap',
        cells: props.combos.map(combo => ({
          text: combo.finishTimeSec === undefined || props.fastestTimeSec === undefined ? '-' : formatDurationGap(combo.finishTimeSec - props.fastestTimeSec, 'Fastest in results')
        }))
      },
      {
        label: 'Drag area vs stock',
        cells: props.combos.map((combo) => {
          const delta = comboPhysicsDelta(combo)
          return { text: delta ? `${formatSignedDelta(delta.cdaDeltaM2, 4)} m²` : '-' }
        })
      },
      {
        label: 'Mass vs stock',
        cells: props.combos.map((combo) => {
          const delta = comboPhysicsDelta(combo)
          return { text: delta ? `${formatSignedDelta(delta.bikeMassDeltaKg, 2)} kg` : '-' }
        })
      },
      {
        label: 'Frame data',
        cells: props.combos.map(combo => ({ text: dataLabel(combo.frame.confidence), status: combo.frame.confidence === 'measured' ? 'success' : 'warning' }))
      },
      {
        label: 'Wheel data',
        cells: props.combos.map(combo => combo.wheelset
          ? { text: dataLabel(combo.wheelset.confidence), status: combo.wheelset.confidence === 'measured' ? 'success' : 'warning' }
          : { text: 'Fixed disc' })
      },
      {
        // Only a measured frame has per-stage data, so only there is the stage a statistic.
        label: 'Upgrade stage',
        cells: props.combos.map(combo => ({ text: combo.frame.confidence === 'measured' ? `${combo.frame.level} of 5` : '-' }))
      },
      {
        label: 'Rough-surface cost',
        cells: props.combos.map(combo => ({ text: combo.surfaceTimePenaltySec === undefined ? '-' : `${combo.surfaceTimePenaltySec.toFixed(1)} s` }))
      },
      {
        label: 'Match score',
        cells: props.combos.map(combo => ({ text: `${combo.score} of 100` }))
      },
      {
        label: 'Compatible wheels',
        cells: props.combos.map(combo => ({ text: combo.wheelOptions ? String(combo.wheelOptions) : '-' }))
      }
    ] as { label: string, cells: { text: string, status?: 'success' | 'warning' }[] }[]
  : [])
</script>

<template>
  <section
    v-if="combos.length"
    :id="COMPARISON_ID"
    aria-labelledby="ride-comparison-heading"
    aria-live="polite"
    tabindex="-1"
    class="scroll-mt-24 outline-none"
  >
    <div class="flex items-center justify-between gap-4">
      <h2
        id="ride-comparison-heading"
        class="text-2xl font-semibold font-heading text-highlighted"
      >
        Selected setups <span class="text-md font-normal font-sans text-muted">{{ combos.length }} of {{ COMPARISON_LIMIT }}</span>
      </h2>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="outline"
        size="sm"
        label="Clear"
        aria-label="Clear comparison"
        @click="$emit('clear')"
      />
    </div>
    <div class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[34rem] border-collapse text-md">
        <caption class="sr-only">
          The picked setups, one per column
        </caption>
        <thead>
          <tr class="border-b border-accented align-top">
            <th
              scope="col"
              class="w-44 px-2.5 pb-3 text-left text-xs font-medium text-muted"
            >
              Setup
            </th>
            <th
              v-for="combo in combos"
              :key="comboKey(combo)"
              scope="col"
              class="px-2.5 pb-3 text-left font-normal"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="font-semibold text-highlighted break-words">
                    {{ combo.frame.name }}
                  </p>
                  <p class="text-sm text-muted break-words">
                    {{ combo.wheelset?.name ?? 'Fixed disc wheels' }}
                  </p>
                </div>
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Remove ${combo.frame.name} from comparison`"
                  @click="$emit('remove', comboKey(combo))"
                />
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b border-default">
            <th
              scope="row"
              class="px-2.5 py-2.5 text-left text-sm font-normal text-toned"
            >
              Finish time
            </th>
            <td
              v-for="combo in combos"
              :key="comboKey(combo)"
              class="px-2.5 py-2.5 text-2xl font-semibold font-timing text-highlighted"
            >
              {{ combo.finishTimeSec !== undefined ? formatDuration(combo.finishTimeSec) : '-' }}
            </td>
          </tr>
          <tr
            v-for="row in rows"
            :key="row.label"
            class="border-b border-default"
          >
            <th
              scope="row"
              class="px-2.5 py-2 text-left text-sm font-normal text-toned"
            >
              {{ row.label }}
            </th>
            <td
              v-for="(cell, index) in row.cells"
              :key="index"
              class="px-2.5 py-2"
              :class="cell.status === 'success' ? 'text-success' : cell.status === 'warning' ? 'text-warning' : ''"
            >
              {{ cell.text }}
            </td>
          </tr>
          <tr>
            <th
              scope="row"
              class="px-2.5 py-2.5 text-left align-top text-sm font-normal text-toned"
            >
              Terrain fit
            </th>
            <td
              v-for="combo in combos"
              :key="comboKey(combo)"
              class="px-2.5 py-2.5 align-top"
            >
              <ScoreBreakdown :breakdown="combo.breakdown" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
