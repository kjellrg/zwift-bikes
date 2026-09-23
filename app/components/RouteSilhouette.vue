<script setup lang="ts">
import type { Silhouette } from '#shared/utils/silhouette'

/**
 * A Silhouette drawn small, unlabelled, as a route or segment is listed: the
 * outline in the neutral ink over a faint fill, and - where the surfaces'
 * positions are known and the caller asks for it - a thin surface strip in
 * the two surface colours beneath. Decorative: the card around it names the
 * ride and gives its numbers, so it is hidden from assistive tech.
 *
 * With no shape to draw (a ride with no measured profile) it draws a dashed
 * baseline instead of the model's approximation, so a listing keeps its
 * rhythm without pretending to know the terrain.
 */
defineProps<{
  shape: Silhouette | undefined
  /** Draw the surface strip beneath, when there are positions to draw. */
  strip?: boolean
}>()

const VIEW_WIDTH = 200
const VIEW_HEIGHT = 50

function outline(shape: Silhouette) {
  const line = shape.points
    .map((point, index) => `${index ? 'L' : 'M'}${(point.x * VIEW_WIDTH).toFixed(1)},${(VIEW_HEIGHT - 3 - point.y * (VIEW_HEIGHT - 8)).toFixed(1)}`)
    .join(' ')
  return { line, area: `${line} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z` }
}
</script>

<template>
  <div aria-hidden="true">
    <svg
      :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
      preserveAspectRatio="none"
      class="block h-full w-full overflow-visible"
      data-silhouette
    >
      <template v-if="shape">
        <path
          :d="outline(shape).area"
          class="fill-ink/10"
        />
        <path
          :d="outline(shape).line"
          fill="none"
          class="stroke-ink"
          stroke-width="1.5"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </template>
      <line
        v-else
        x1="0"
        :x2="VIEW_WIDTH"
        :y1="VIEW_HEIGHT - 3"
        :y2="VIEW_HEIGHT - 3"
        class="stroke-rule-strong"
        stroke-width="1.5"
        stroke-dasharray="4 4"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div
      v-if="strip && shape?.surfaces.length"
      class="mt-1 flex h-1 overflow-hidden rounded-[2px]"
    >
      <span
        v-for="(span, index) in shape.surfaces"
        :key="index"
        class="block h-full"
        :class="SURFACE_FAMILY_BG[span.family]"
        :style="{ width: `${((span.to - span.from) * 100).toFixed(2)}%` }"
      />
    </div>
  </div>
</template>
