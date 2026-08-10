<script setup lang="ts">
import type { BikeCategory, RouteWithMeta } from '../../../shared/types/catalog'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const preferredRouteSlug = computed(() => typeof route.query.route === 'string' ? route.query.route : undefined)
const { data: segmentData, error: segmentError } = await useFetch(() => `/api/segments/${slug.value}`)
if (segmentError.value) throw createError({ statusCode: 404, statusMessage: 'Segment not found', fatal: true })

const { owned, ownedWheels, load: loadGarage } = useGarage()
const { weightKg, heightCm, wkg, defaultUnownedLevel, load: loadRiderProfile, setWeightKg, setWkg, setHeightCm } = useRiderProfile()
const { verifiedOnly, myBikesOnly, load: loadPreferences, setVerifiedOnly, setMyBikesOnly } = usePreferences()
onMounted(() => {
  loadGarage()
  loadRiderProfile()
  loadPreferences()
  draftHeightCm.value = heightCm.value
  draftWkg.value = wkg.value
})

const bikeSearch = ref('')
const bikeSearchDebounced = ref('')
let bikeSearchDebounceTimer: ReturnType<typeof setTimeout> | undefined
watch(bikeSearch, (value) => { clearTimeout(bikeSearchDebounceTimer); bikeSearchDebounceTimer = setTimeout(() => { bikeSearchDebounced.value = value }, 300) })
const categoryFilter = ref<BikeCategory | 'all'>('all')
const pageSize = 9

const draftHeightCm = ref(heightCm.value)
const draftWkg = ref(wkg.value)
const commitHeight = () => setHeightCm(draftHeightCm.value)
const commitWkg = () => setWkg(draftWkg.value)
watch(heightCm, (value) => { draftHeightCm.value = value })
watch(wkg, (value) => { draftWkg.value = value })

// A ranking is always a single pass over the segment - there's no fatigue
// model, so which lap a `perLap` segment falls on doesn't change its
// physics, unlike a whole route where lap count changes total distance.
const recommendQuery = computed(() => ({
  search: bikeSearchDebounced.value || undefined,
  category: categoryFilter.value !== 'all' ? categoryFilter.value : undefined,
  route: preferredRouteSlug.value,
  limit: pageSize,
  offset: 0,
  verifiedOnly: verifiedOnly.value ? 'true' : undefined,
  ownedOnly: myBikesOnly.value ? 'true' : undefined,
  owned: Object.keys(owned.value).length ? JSON.stringify(owned.value) : undefined,
  ownedWheels: Object.keys(ownedWheels.value).length ? JSON.stringify(Object.keys(ownedWheels.value)) : undefined,
  defaultUnownedLevel: defaultUnownedLevel.value,
  weightKg: weightKg.value,
  heightCm: heightCm.value,
  wkg: wkg.value
}))
const { data: recommendData, status, refresh: refreshRecommendations } = await useFetch(() => `/api/recommend/segments/${slug.value}`, { query: recommendQuery, watch: false })

const loadedCombos = ref<any[]>([])
const hasMore = ref(true)
const loadingMore = ref(false)
watch(recommendData, (data) => {
  if (!data) return
  loadedCombos.value = data.combos ?? []
  hasMore.value = data.pagination?.hasMore ?? false
}, { immediate: true })

async function refreshFirstPage() {
  await refreshRecommendations()
}

async function showMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const nextPage = await $fetch(`/api/recommend/segments/${slug.value}`, {
      query: { ...recommendQuery.value, offset: loadedCombos.value.length, limit: pageSize }
    })
    loadedCombos.value = [...loadedCombos.value, ...(nextPage.combos ?? [])]
    hasMore.value = nextPage.pagination?.hasMore ?? false
  } finally {
    loadingMore.value = false
  }
}

watch([weightKg, heightCm, wkg, myBikesOnly, verifiedOnly, categoryFilter, bikeSearchDebounced], () => { refreshFirstPage() })
watch(owned, () => { refreshFirstPage() }, { deep: true })
watch(ownedWheels, () => { refreshFirstPage() }, { deep: true })

const categoryOptions: { label: string, value: BikeCategory | 'all' }[] = [
  { label: 'All categories', value: 'all' }, { label: BIKE_CATEGORY_LABELS.standard, value: 'standard' },
  { label: BIKE_CATEGORY_LABELS.tt, value: 'tt' }, { label: BIKE_CATEGORY_LABELS.gravel, value: 'gravel' },
  { label: BIKE_CATEGORY_LABELS.funbike, value: 'funbike' }, { label: BIKE_CATEGORY_LABELS.handbike, value: 'handbike' }
]
const combos = computed(() => loadedCombos.value)
const topCombo = computed(() => combos.value[0])
const restCombos = computed(() => combos.value.slice(1))
const fastestTimeSec = computed(() => { const times = combos.value.map(c => c.finishTimeSec).filter((t): t is number => typeof t === 'number'); return times.length ? Math.min(...times) : undefined })
const physicsInfo = computed(() => recommendData.value?.physics)
const physicsIsDynamic = computed(() => physicsInfo.value?.mode === 'dynamic')

// Minimal `RouteWithMeta`-shaped stand-in so `ComboResultCard` can compute
// the segment's own distance for the km/h display via `computeRouteTotals`
// - it only ever reads `distance`/`lap`/`leadInDistance` for that.
const segmentAsRoute = computed(() => segmentData.value
  ? ({ distance: segmentData.value.lengthKm, lap: false, leadInDistance: undefined } as RouteWithMeta)
  : undefined)
</script>

<template>
  <UContainer
    v-if="segmentData"
    class="py-10 space-y-10"
  >
    <div>
      <UButton
        to="/"
        variant="link"
        color="neutral"
        icon="i-lucide-arrow-left"
        class="mb-4 px-0"
      >
        Back to all routes
      </UButton>
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold text-highlighted">
            {{ segmentData.name }}
          </h1><p class="text-muted">
            {{ segmentData.worldName }}
          </p>
        </div>
        <div class="flex flex-col items-start sm:items-end gap-1.5">
          <div class="flex flex-wrap sm:justify-end gap-2">
            <UBadge
              :color="segmentData.type === 'climb' ? 'success' : 'warning'"
              variant="subtle"
              :icon="segmentData.type === 'climb' ? 'i-lucide-mountain' : 'i-lucide-zap'"
            >
              {{ segmentData.type === "climb" ? "Climb" : "Sprint" }}
            </UBadge>
            <UBadge
              v-if="segmentData.climbType"
              :color="CLIMB_TYPE_COLORS[segmentData.climbType]"
              variant="subtle"
            >
              {{ segmentData.climbType === "HC" ? "HC" : `Cat ${segmentData.climbType}` }}
            </UBadge>
            <UBadge
              v-if="physicsIsDynamic"
              color="primary"
              variant="subtle"
              icon="i-lucide-atom"
            >
              Dynamic physics
            </UBadge>
          </div>
        </div>
      </div>
      <div class="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Length
          </p><p class="text-xl font-bold">
            {{ formatDistance(segmentData.lengthKm) }}
          </p>
        </UCard>
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Elevation
          </p><p class="text-xl font-bold">
            {{ formatElevation(segmentData.elevationM) }}
          </p>
        </UCard>
        <UCard :ui="{ body: 'text-center py-4' }">
          <p class="text-xs text-muted uppercase tracking-wide">
            Avg grade
          </p><p class="text-xl font-bold">
            {{ segmentData.avgGradePercent ? formatGrade(segmentData.avgGradePercent) : "Flat" }}
          </p>
        </UCard>
      </div>
      <p
        v-if="segmentData.hostRoutes.length"
        class="mt-4 text-sm text-muted"
      >
        <span class="font-medium text-highlighted">Also appears on:</span>
        <template
          v-for="(host, index) in segmentData.hostRoutes"
          :key="host.slug"
        >
          <ULink
            :to="`/routes/${host.slug}`"
            class="text-primary underline"
          >{{ host.name }}</ULink><span v-if="index < segmentData.hostRoutes.length - 1">, </span>
        </template>
      </p>
    </div>

    <UAlert
      v-if="physicsInfo"
      color="primary"
      variant="subtle"
      icon="i-lucide-atom"
      :title="physicsIsDynamic ? 'Dynamic physics model active' : 'Legacy finish-time model'"
      :description="physicsInfo.note"
    />
    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="How this recommendation works"
      description="Combos are ranked by an estimated time for this segment alone, computed from a simplified physics model (your weight, height &amp; power, the segment's real length/gradient, and each combo's aerodynamic drag and weight) rather than the match score alone. The segment is simulated after a flat warmup so it starts at realistic speed, matching how a real Zwift/Strava segment is entered. Bike frame and wheelset aero/climb ratings come from real ZwiftInsider bot speed-test data where available (look for the 'verified' badge) - otherwise they're a name-based heuristic estimate. None of this is official Zwift telemetry, so treat results as directionally useful, not exact."
    />

    <div>
      <h2 class="text-xl font-semibold text-highlighted mb-4">
        Best bike &amp; wheel combo for this segment
      </h2>
      <div class="flex flex-wrap items-end gap-4 rounded-lg border border-default p-4 mb-6">
        <div class="min-w-48">
          <label class="block text-xs font-medium text-muted mb-1">Bike category</label><USelectMenu
            v-model="categoryFilter"
            value-key="value"
            :items="categoryOptions"
            :search-input="false"
            class="w-52"
          />
        </div>
        <div class="min-w-56 flex-1">
          <label class="block text-xs font-medium text-muted mb-1">Search bikes or wheels</label><UInput
            v-model="bikeSearch"
            icon="i-lucide-search"
            placeholder="e.g. Tarmac, Aethos, Zipp, DICUT..."
          />
        </div>
        <div class="flex items-center gap-2">
          <USwitch
            :model-value="verifiedOnly"
            @update:model-value="(value: boolean) => setVerifiedOnly(value)"
          /><span class="text-sm">Only show verified frames/wheels</span>
        </div>
        <div class="flex items-center gap-2">
          <USwitch
            :model-value="myBikesOnly"
            @update:model-value="(value: boolean) => setMyBikesOnly(value)"
          /><span class="text-sm">Only show items in my garage</span><ULink
            to="/garage"
            class="text-sm text-primary underline"
          >(edit garage)</ULink>
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-6 rounded-lg border border-default p-4 mb-6">
        <div class="w-40">
          <label class="block text-xs font-medium text-muted mb-1">Rider weight (kg)</label><UInput
            :model-value="weightKg"
            type="number"
            min="30"
            max="150"
            step="1"
            @update:model-value="(value: string | number) => setWeightKg(Number(value))"
          />
        </div>
        <div class="w-full sm:w-56">
          <label class="block text-xs font-medium text-muted mb-1">Height: {{ draftHeightCm }} cm</label><input
            v-model.number="draftHeightCm"
            type="range"
            min="100"
            max="220"
            step="1"
            class="w-full cursor-pointer"
            aria-label="Rider height"
            @change="commitHeight"
          >
        </div>
        <div class="min-w-64 flex-1">
          <label class="block text-xs font-medium text-muted mb-1">Power: {{ draftWkg.toFixed(1) }} W/kg ({{ Math.round(draftWkg * weightKg) }} W)</label><input
            v-model.number="draftWkg"
            type="range"
            min="1"
            max="6.9"
            step="0.1"
            class="w-full cursor-pointer"
            aria-label="Rider power in watts per kilogram"
            @change="commitWkg"
          >
        </div>
        <ULink
          to="/profile"
          class="text-sm text-primary underline self-center"
        >(edit profile)</ULink>
      </div>

      <div
        v-if="status === 'pending' && !recommendData"
        class="text-center py-10 text-muted"
      >
        Calculating best matches...
      </div>
      <template v-else>
        <ComboResultCard
          v-if="topCombo"
          :combo="topCombo"
          :rank="1"
          :route="segmentAsRoute"
          :weight-kg="weightKg"
          :height-cm="heightCm"
          :wkg="wkg"
          :laps="1"
          :fastest-time-sec="fastestTimeSec"
          :owned="owned"
          class="mb-6"
        />
        <div
          v-if="restCombos.length"
          class="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <ComboResultCard
            v-for="(combo, index) in restCombos"
            :key="`${combo.frame.id}-${combo.wheelset?.key ?? 'fixed'}`"
            :combo="combo"
            :rank="index + 2"
            :route="segmentAsRoute"
            :weight-kg="weightKg"
            :height-cm="heightCm"
            :wkg="wkg"
            :laps="1"
            :fastest-time-sec="fastestTimeSec"
            :owned="owned"
          />
        </div>
        <p
          v-else-if="!topCombo"
          class="text-muted text-center py-10"
        >
          No bikes match your filters.
        </p>
        <div
          v-if="hasMore"
          class="text-center mt-6"
        >
          <UButton
            color="neutral"
            variant="subtle"
            :loading="loadingMore"
            @click="showMore"
          >
            Show more matches
          </UButton>
        </div>
      </template>
    </div>
  </UContainer>
</template>
