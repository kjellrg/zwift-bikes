<script setup lang="ts">
// Social-share card for a route page (issue #59). Rendered to a static
// 1200x630 PNG at build time by nuxt-og-image (zeroRuntime) - never in the
// browser or the Worker. Takumi supports a flexbox-only CSS subset, hence
// the inline styles and the absence of grid/UApp/Nuxt UI components. The
// bundled font is Inter 400/700, so no other weights are used.
const props = defineProps<{
  title: string
  world: string
  distance: string
  elevation: string
  frameName?: string
  wheelName?: string
  /**
   * Elevation silhouette: samples at even distances across lead-in + one
   * lap, each already normalized to 0..1 of the route's own height range -
   * see `ogProfileFromPoints` in `app/utils/ogProfile.ts`.
   */
  profile?: number[]
}>()

// Long route names ("Queen's Highway After Party") step down instead of
// clipping - Takumi has no line-clamp, so the size must guarantee a fit.
const titleSize = computed(() => props.title.length > 24 ? '56px' : '72px')

const setupLabel = computed(() => {
  if (!props.frameName) return undefined
  return props.wheelName ? `${props.frameName} + ${props.wheelName}` : props.frameName
})
const setupSize = computed(() => (setupLabel.value?.length ?? 0) > 44 ? '30px' : '38px')

// The silhouette is passed to Takumi as a data-URI <img> rather than an
// inline <svg> element: raster-from-src is the documented, dependable path.
const profileImage = computed(() => {
  const values = props.profile
  if (!values || values.length < 2) return undefined
  const w = 1200
  const h = 230
  const step = w / (values.length - 1)
  const points = values.map((v, i) => `${Math.round(i * step)},${Math.round(h - 6 - v * (h - 12))}`).join(' ')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<polygon points="0,${h} ${points} ${w},${h}" fill="rgba(0,220,130,0.14)"/>`
    + `<polyline points="${points}" fill="none" stroke="rgba(0,220,130,0.5)" stroke-width="3"/>`
    + `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
})
</script>

<template>
  <div
    class="flex h-full w-full flex-col justify-between"
    style="background: linear-gradient(160deg, #0D1C19 0%, #071412 100%); padding: 56px 64px; position: relative;"
  >
    <img
      v-if="profileImage"
      :src="profileImage"
      alt=""
      style="position: absolute; left: 0; bottom: 0; width: 1200px; height: 230px;"
    >

    <div
      class="flex items-center"
      style="gap: 16px;"
    >
      <div style="width: 14px; height: 34px; background: #C6F135; border-radius: 4px;" />
      <span style="font-size: 34px; font-weight: 700; color: #ffffff;">ZwiftBikes</span>
    </div>

    <div
      class="flex flex-col"
      style="gap: 12px;"
    >
      <span style="font-size: 26px; font-weight: 700; color: #C6F135; letter-spacing: 4px;">BEST BIKE FOR</span>
      <span :style="{ fontSize: titleSize, fontWeight: 700, color: '#ffffff', lineHeight: 1.05 }">{{ title }}</span>
      <span style="font-size: 30px; color: #8FA79F;">{{ world }} · {{ distance }} · {{ elevation }}</span>
    </div>

    <div
      v-if="setupLabel"
      class="flex flex-col"
      style="gap: 8px;"
    >
      <span style="font-size: 22px; font-weight: 700; color: #8FA79F; letter-spacing: 3px;">FASTEST SETUP</span>
      <span :style="{ fontSize: setupSize, fontWeight: 700, color: '#ffffff' }">{{ setupLabel }}</span>
    </div>
  </div>
</template>
