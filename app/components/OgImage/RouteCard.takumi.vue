<script setup lang="ts">
import type { Silhouette } from '#shared/utils/silhouette'
import { OG_COLORS, OG_MARK_IMAGE, ogProfileImage } from '../../utils/ogProfile'

// Social-share card for a route page (issue #59), repainted in the night
// Palette and Archivo (#257). Rendered to a static 1200x630 PNG at build
// time by nuxt-og-image (zeroRuntime) - never in the browser or the Worker.
// Takumi supports a flexbox-only CSS subset, hence the inline styles and the
// absence of grid/UApp/Nuxt UI components; its colours are `OG_COLORS`,
// because it reads no CSS variables.
const props = defineProps<{
  title: string
  world: string
  distance: string
  elevation: string
  frameName?: string
  wheelName?: string
  /** The route's Silhouette - see `OG_SILHOUETTE_SAMPLES`. */
  profile?: Silhouette
}>()

// Long route names ("Queen's Highway After Party") step down instead of
// clipping - Takumi has no line-clamp, so the size must guarantee a fit.
const titleSize = computed(() => props.title.length > 24 ? '60px' : '80px')

const setupLabel = computed(() => {
  if (!props.frameName) return undefined
  return props.wheelName ? `${props.frameName} with ${props.wheelName}` : props.frameName
})
const setupSize = computed(() => (setupLabel.value?.length ?? 0) > 44 ? '28px' : '34px')

const profileImage = computed(() => props.profile && props.profile.heights.length > 1 ? ogProfileImage(props.profile, 1072, 150) : undefined)
</script>

<template>
  <div
    class="flex h-full w-full flex-col"
    :style="{ background: OG_COLORS.ground, padding: '52px 64px 48px', fontFamily: 'Archivo' }"
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
      style="gap: 6px; margin-top: 26px;"
    >
      <span :style="{ fontSize: '30px', color: OG_COLORS.toned }">The fastest bike for</span>
      <span :style="{ fontSize: titleSize, fontWeight: 700, color: OG_COLORS.ink, lineHeight: 1.02, fontStretch: '78%' }">{{ title }}</span>
      <span :style="{ fontSize: '26px', color: OG_COLORS.muted, marginTop: '6px' }">{{ world }} · {{ distance }} · {{ elevation }}</span>
    </div>

    <img
      v-if="profileImage"
      :src="profileImage"
      alt=""
      style="width: 1072px; height: 150px; margin-top: auto; flex-shrink: 0;"
    >

    <div
      v-if="setupLabel"
      class="flex items-baseline"
      :style="{ gap: '14px', marginTop: profileImage ? '18px' : 'auto' }"
    >
      <span :style="{ fontSize: '22px', fontWeight: 600, color: OG_COLORS.primary }">Fastest setup</span>
      <span :style="{ fontSize: setupSize, fontWeight: 600, color: OG_COLORS.ink }">{{ setupLabel }}</span>
    </div>
  </div>
</template>
