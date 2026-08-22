<script setup lang="ts">
// Social-share card for an event race page (issue #59). Same build-time
// Takumi constraints as RouteCard: flexbox-only CSS, Inter 400/700.
const props = defineProps<{
  /** Series + season, shown as the eyebrow (e.g. "DIRT Racing Series"). */
  series: string
  /** Race heading (e.g. "Week 3 - Mountain Mash"). */
  title: string
  /** Course line: route names plus format (e.g. "Mountain Mash · Scratch race"). */
  course: string
  date: string
  frameName?: string
  wheelName?: string
}>()

const titleSize = computed(() => props.title.length > 24 ? '52px' : '64px')

const setupLabel = computed(() => {
  if (!props.frameName) return undefined
  return props.wheelName ? `${props.frameName} + ${props.wheelName}` : props.frameName
})
const setupSize = computed(() => (setupLabel.value?.length ?? 0) > 44 ? '30px' : '38px')
</script>

<template>
  <div
    class="flex h-full w-full flex-col justify-between"
    style="background: linear-gradient(160deg, #0b1220 0%, #030712 100%); padding: 56px 64px;"
  >
    <div
      class="flex items-center"
      style="gap: 16px;"
    >
      <div style="width: 14px; height: 34px; background: #00DC82; border-radius: 4px;" />
      <span style="font-size: 34px; font-weight: 700; color: #ffffff;">ZwiftBikes</span>
    </div>

    <div
      class="flex flex-col"
      style="gap: 12px;"
    >
      <span style="font-size: 26px; font-weight: 700; color: #00DC82; letter-spacing: 4px;">{{ series.toUpperCase() }}</span>
      <span :style="{ fontSize: titleSize, fontWeight: 700, color: '#ffffff', lineHeight: 1.05 }">{{ title }}</span>
      <span style="font-size: 30px; color: #94a3b8;">{{ course }} · {{ date }}</span>
    </div>

    <div
      v-if="setupLabel"
      class="flex flex-col"
      style="gap: 8px;"
    >
      <span style="font-size: 22px; font-weight: 700; color: #94a3b8; letter-spacing: 3px;">FASTEST LEGAL SETUP</span>
      <span :style="{ fontSize: setupSize, fontWeight: 700, color: '#ffffff' }">{{ setupLabel }}</span>
    </div>
  </div>
</template>
