<script setup lang="ts">
import { OG_COLORS, OG_MARK_IMAGE } from '../../utils/ogProfile'

// Brand social-share card for the home and about pages (issue #59): same
// build-time Takumi constraints as RouteCard - flexbox-only CSS, Archivo,
// the Palette's values from `OG_COLORS`. No props: one card, one message, everywhere the site itself
// (rather than a specific route or race) is what's being shared.
</script>

<template>
  <div
    class="flex h-full w-full flex-col justify-between"
    :style="{ background: OG_COLORS.ground, padding: '56px 64px', fontFamily: 'Archivo' }"
  >
    <div
      class="flex items-center"
      style="gap: 14px;"
    >
      <img
        :src="OG_MARK_IMAGE"
        alt=""
        style="width: 45px; height: 30px;"
      >
      <span :style="{ fontSize: '32px', fontWeight: 700, color: OG_COLORS.ink }">ZwiftBikes</span>
    </div>

    <div
      class="flex flex-col"
      style="gap: 18px;"
    >
      <span :style="{ fontSize: '84px', fontWeight: 700, color: OG_COLORS.ink, lineHeight: 1, fontStretch: '78%' }">The fastest bike for any Zwift route</span>
      <span :style="{ fontSize: '30px', color: OG_COLORS.toned, lineHeight: 1.35 }">Every frame and wheelset in the game, ridden over the route's real elevation and surfaces at your weight and power, and ranked by finish time.</span>
    </div>

    <span :style="{ fontSize: '26px', fontWeight: 600, color: OG_COLORS.primary }">zwiftbikes.com</span>
  </div>
</template>
