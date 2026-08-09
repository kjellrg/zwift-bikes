<script setup lang="ts">
import type { BikeCategory } from "../../../shared/types/catalog";

const route = useRoute();
const slug = computed(() => route.params.slug as string);
const { data: routeData, error: routeError } = await useFetch(() => `/api/routes/${slug.value}`);
if (routeError.value) throw createError({ statusCode: 404, statusMessage: "Route not found", fatal: true });

const { owned, ownedWheels, load: loadGarage } = useGarage();
const { weightKg, heightCm, wkg, defaultUnownedLevel, load: loadRiderProfile, setWeightKg, setWkg, setHeightCm } = useRiderProfile();
const { verifiedOnly, load: loadPreferences, setVerifiedOnly } = usePreferences();
onMounted(() => {
  loadGarage();
  loadRiderProfile();
  loadPreferences();
  draftHeightCm.value = heightCm.value;
  draftWkg.value = wkg.value;
});

const bikeSearch = ref("");
const bikeSearchDebounced = ref("");
let bikeSearchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(bikeSearch, (value) => { clearTimeout(bikeSearchDebounceTimer); bikeSearchDebounceTimer = setTimeout(() => { bikeSearchDebounced.value = value; }, 300); });
const categoryFilter = ref<BikeCategory | "all">("all");
const pageSize = 9;
const myBikesOnly = ref(false);
const laps = ref(1);
const lapOptions = Array.from({ length: MAX_LAPS }, (_, i) => ({ label: `${i + 1} lap${i === 0 ? "" : "s"}`, value: i + 1 }));
const routeTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, laps.value) : undefined);

const draftHeightCm = ref(heightCm.value);
const draftWkg = ref(wkg.value);
const commitHeight = () => setHeightCm(draftHeightCm.value);
const commitWkg = () => setWkg(draftWkg.value);
watch(heightCm, (value) => { draftHeightCm.value = value; });
watch(wkg, (value) => { draftWkg.value = value; });

const recommendQuery = computed(() => ({
  search: bikeSearchDebounced.value || undefined,
  category: categoryFilter.value !== "all" ? categoryFilter.value : undefined,
  limit: pageSize,
  offset: 0,
  verifiedOnly: verifiedOnly.value ? "true" : undefined,
  ownedOnly: myBikesOnly.value ? "true" : undefined,
  owned: Object.keys(owned.value).length ? JSON.stringify(owned.value) : undefined,
  ownedWheels: Object.keys(ownedWheels.value).length ? JSON.stringify(Object.keys(ownedWheels.value)) : undefined,
  defaultUnownedLevel: defaultUnownedLevel.value,
  weightKg: weightKg.value,
  heightCm: heightCm.value,
  wkg: wkg.value,
  laps: laps.value,
}));
const { data: recommendData, status, refresh: refreshRecommendations } = await useFetch(() => `/api/recommend/${slug.value}`, { query: recommendQuery, watch: false });

const loadedCombos = ref<any[]>([]);
const hasMore = ref(true);
const loadingMore = ref(false);
watch(recommendData, (data) => {
  if (!data) return;
  loadedCombos.value = data.combos ?? [];
  hasMore.value = data.pagination?.hasMore ?? false;
}, { immediate: true });

async function refreshFirstPage() {
  loadedCombos.value = [];
  hasMore.value = true;
  await refreshRecommendations();
}

async function showMore() {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const nextPage = await $fetch(`/api/recommend/${slug.value}`, {
      query: { ...recommendQuery.value, offset: loadedCombos.value.length, limit: pageSize }
    });
    loadedCombos.value = [...loadedCombos.value, ...(nextPage.combos ?? [])];
    hasMore.value = nextPage.pagination?.hasMore ?? false;
  } finally {
    loadingMore.value = false;
  }
}

watch([weightKg, heightCm, wkg, laps, myBikesOnly, verifiedOnly, categoryFilter, bikeSearchDebounced], () => { refreshFirstPage(); });
watch([owned, ownedWheels], () => { refreshFirstPage(); }, { deep: true });

const categoryOptions: { label: string; value: BikeCategory | "all" }[] = [
  { label: "All categories", value: "all" }, { label: BIKE_CATEGORY_LABELS.standard, value: "standard" },
  { label: BIKE_CATEGORY_LABELS.tt, value: "tt" }, { label: BIKE_CATEGORY_LABELS.gravel, value: "gravel" },
  { label: BIKE_CATEGORY_LABELS.funbike, value: "funbike" }, { label: BIKE_CATEGORY_LABELS.handbike, value: "handbike" },
];
const combos = computed(() => loadedCombos.value);
const topCombo = computed(() => combos.value[0]);
const restCombos = computed(() => combos.value.slice(1));
const fastestTimeSec = computed(() => { const times = combos.value.map(c => c.finishTimeSec).filter((t): t is number => typeof t === "number"); return times.length ? Math.min(...times) : undefined; });
const surfaceTimePenaltyText = computed(() => routeData.value ? formatSurfaceTimePenalty(routeData.value.surface, topCombo.value?.surfaceTimePenaltySec) : undefined);
const physicsInfo = computed(() => recommendData.value?.physics);
const physicsIsDynamic = computed(() => physicsInfo.value?.mode === "dynamic");
</script>

<template>
  <UContainer v-if="routeData" class="py-10 space-y-10">
    <div>
      <UButton to="/" variant="link" color="neutral" icon="i-lucide-arrow-left" class="mb-4 px-0">Back to all routes</UButton>
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div><h1 class="text-3xl font-bold text-highlighted">{{ routeData.name }}</h1><p class="text-muted">{{ routeData.worldName }}</p></div>
        <div class="flex flex-col items-start sm:items-end gap-1.5"><div class="flex flex-wrap sm:justify-end gap-2">
          <TerrainBadge :terrain="routeData.terrain" /><SurfaceBadges :surface="routeData.surface" />
          <UBadge v-if="physicsIsDynamic" color="primary" variant="subtle" icon="i-lucide-atom">Dynamic physics</UBadge>
          <UBadge v-if="routeData.eventOnly" color="error" variant="subtle" icon="i-lucide-calendar-clock">Event only</UBadge>
        </div><p v-if="surfaceTimePenaltyText" class="text-xs text-muted sm:text-right">{{ surfaceTimePenaltyText }}</p></div>
      </div>
      <div class="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <UCard :ui="{ body: 'text-center py-4' }"><p class="text-xs text-muted uppercase tracking-wide">Distance</p><p class="text-xl font-bold">{{ formatDistance(routeTotals?.distanceKm ?? routeData.distance) }}</p></UCard>
        <UCard :ui="{ body: 'text-center py-4' }"><p class="text-xs text-muted uppercase tracking-wide">Elevation</p><p class="text-xl font-bold">{{ formatElevation(routeTotals?.elevationM ?? routeData.elevation) }}</p></UCard>
        <UCard :ui="{ body: 'text-center py-4' }"><p class="text-xs text-muted uppercase tracking-wide">Climb ratio</p><p class="text-xl font-bold">{{ routeData.terrain.climbRatio.toFixed(1) }} m/km</p></UCard>
        <UCard :ui="{ body: 'text-center py-4' }"><p class="text-xs text-muted uppercase tracking-wide">Terrain</p><p class="text-xl font-bold">{{ TERRAIN_LABELS[routeData.terrain.category] }}</p></UCard>
      </div>
      <div v-if="routeData.lap || routeData.leadInDistance" class="mt-4 flex flex-wrap items-end gap-4 rounded-lg border border-default p-4">
        <div v-if="routeData.lap" class="w-40"><label class="block text-xs font-medium text-muted mb-1">Laps</label><USelectMenu v-model="laps" value-key="value" :items="lapOptions" :search-input="false" /></div>
        <p v-if="routeTotals && routeTotals.leadInDistanceKm > 0" class="text-sm text-muted"><span class="font-medium text-highlighted">Lead-in:</span> {{ formatDistance(routeTotals.leadInDistanceKm) }}<template v-if="routeTotals.leadInElevationM > 0"> / {{ formatElevation(routeTotals.leadInElevationM) }}</template> (ridden once, not repeated per lap)</p>
      </div>
    </div>

    <UAlert v-if="physicsInfo" color="primary" variant="subtle" icon="i-lucide-atom" :title="physicsIsDynamic ? 'Dynamic physics model active' : 'Legacy finish-time model'" :description="physicsInfo.note" />
    <UAlert color="neutral" variant="subtle" icon="i-lucide-info" title="How this recommendation works" description="Combos are ranked by an estimated finish time, computed from a simplified physics model (your weight, height &amp; power, the route's terrain/surface mix, and each combo's aerodynamic drag and weight) rather than the match score alone. Bike frame and wheelset aero/climb ratings come from real ZwiftInsider bot speed-test data where available (look for the 'verified' badge) - otherwise they're a name-based heuristic estimate. Route surface is also a best-effort estimate. None of this is official Zwift telemetry, so treat results as directionally useful, not exact." />

    <div>
      <h2 class="text-xl font-semibold text-highlighted mb-4">Best bike &amp; wheel combo for this route</h2>
      <div class="flex flex-wrap items-end gap-4 rounded-lg border border-default p-4 mb-6">
        <div class="min-w-48"><label class="block text-xs font-medium text-muted mb-1">Bike category</label><USelectMenu v-model="categoryFilter" value-key="value" :items="categoryOptions" :search-input="false" class="w-52" /></div>
        <div class="min-w-56 flex-1"><label class="block text-xs font-medium text-muted mb-1">Search bikes or wheels</label><UInput v-model="bikeSearch" icon="i-lucide-search" placeholder="e.g. Tarmac, Aethos, Zipp, DICUT..." /></div>
        <div class="flex items-center gap-2"><USwitch :model-value="verifiedOnly" @update:model-value="(value: boolean) => setVerifiedOnly(value)" /><span class="text-sm">Only show verified frames/wheels</span></div>
        <div class="flex items-center gap-2"><USwitch v-model="myBikesOnly" /><span class="text-sm">Only show my bikes</span><ULink to="/garage" class="text-sm text-primary underline">(edit garage)</ULink></div>
      </div>

      <div class="flex flex-wrap items-end gap-6 rounded-lg border border-default p-4 mb-6">
        <div class="w-40"><label class="block text-xs font-medium text-muted mb-1">Rider weight (kg)</label><UInput :model-value="weightKg" type="number" min="30" max="150" step="1" @update:model-value="(value: string | number) => setWeightKg(Number(value))" /></div>
        <div class="w-full sm:w-56"><label class="block text-xs font-medium text-muted mb-1">Height: {{ draftHeightCm }} cm</label><input v-model.number="draftHeightCm" type="range" min="100" max="220" step="1" class="w-full cursor-pointer" aria-label="Rider height" @change="commitHeight" /></div>
        <div class="min-w-64 flex-1"><label class="block text-xs font-medium text-muted mb-1">Power: {{ draftWkg.toFixed(1) }} W/kg ({{ Math.round(draftWkg * weightKg) }} W)</label><input v-model.number="draftWkg" type="range" min="1" max="6.9" step="0.1" class="w-full cursor-pointer" aria-label="Rider power in watts per kilogram" @change="commitWkg" /></div>
        <ULink to="/profile" class="text-sm text-primary underline self-center">(edit profile)</ULink>
      </div>

      <div v-if="status === 'pending' && !recommendData" class="text-center py-10 text-muted">Calculating best matches...</div>
      <template v-else>
        <ComboResultCard v-if="topCombo" :combo="topCombo" :rank="1" :route="routeData" :weight-kg="weightKg" :wkg="wkg" :laps="laps" :fastest-time-sec="fastestTimeSec" :owned="owned" class="mb-6" />
        <div v-if="restCombos.length" class="grid grid-cols-1 md:grid-cols-2 gap-4"><ComboResultCard v-for="(combo, index) in restCombos" :key="`${combo.frame.id}-${combo.wheelset?.key ?? 'fixed'}`" :combo="combo" :rank="index + 2" :route="routeData" :weight-kg="weightKg" :wkg="wkg" :laps="laps" :fastest-time-sec="fastestTimeSec" :owned="owned" /></div>
        <p v-else-if="!topCombo" class="text-muted text-center py-10">No bikes match your filters.</p>
        <div v-if="hasMore" class="text-center mt-6"><UButton color="neutral" variant="subtle" :loading="loadingMore" @click="showMore">Show more matches</UButton></div>
      </template>
    </div>
  </UContainer>
</template>
