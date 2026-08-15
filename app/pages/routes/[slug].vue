<script setup lang="ts">
import type { BikeCategory } from "../../../shared/types/catalog";
import { TTT_MAX_CLIMB_WKG, TTT_MAX_RIDERS, TTT_MIN_CLIMB_WKG, TTT_MIN_RIDERS } from "#shared/utils/physics/draft";

const route = useRoute();
const slug = computed(() => route.params.slug as string);

const { owned, ownedWheels, load: loadGarage } = useGarage();
const { weightKg, heightCm, wkg, defaultUnownedLevel, draftMode, tttRiders, tttClimbWkg, load: loadRiderProfile, setWeightKg, setWkg, setHeightCm, setDraftMode, setTttRiders, setTttClimbWkg } = useRiderProfile();
const { verifiedOnly, myBikesOnly, load: loadPreferences, setVerifiedOnly, setMyBikesOnly } = usePreferences();

const bikeSearch = ref("");
const bikeSearchDebounced = ref("");
let bikeSearchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(bikeSearch, (value) => { clearTimeout(bikeSearchDebounceTimer); bikeSearchDebounceTimer = setTimeout(() => { bikeSearchDebounced.value = value; }, 300); });
const categoryFilter = ref<BikeCategory | "all">("all");
const pageSize = 9;
const laps = ref(1);
const lapOptions = Array.from({ length: MAX_LAPS }, (_, i) => ({ label: `${i + 1} lap${i === 0 ? "" : "s"}`, value: i + 1 }));

const recommendQuery = computed(() => ({
  search: bikeSearchDebounced.value || undefined,
  category: categoryFilter.value !== "all" ? categoryFilter.value : undefined,
  limit: pageSize,
  offset: 0,
  // Always sent, never omitted: the endpoint now defaults this to on, so
  // leaving it out when the switch is off would silently keep filtering.
  verifiedOnly: verifiedOnly.value ? 'true' : 'false',
  ownedOnly: myBikesOnly.value ? "true" : undefined,
  owned: Object.keys(owned.value).length ? JSON.stringify(owned.value) : undefined,
  ownedWheels: Object.keys(ownedWheels.value).length ? JSON.stringify(Object.keys(ownedWheels.value)) : undefined,
  defaultUnownedLevel: defaultUnownedLevel.value,
  weightKg: weightKg.value,
  heightCm: heightCm.value,
  wkg: wkg.value,
  laps: laps.value,
  // Omitted entirely in solo mode so SSR/prerendered payloads stay
  // byte-identical to before draft mode existed (localStorage loads
  // onMounted, then the watch below refetches if the persisted mode is TTT).
  draftMode: draftMode.value === "ttt" ? "ttt" : undefined,
  tttRiders: draftMode.value === "ttt" ? tttRiders.value : undefined,
  tttClimbWkg: draftMode.value === "ttt" ? tttClimbWkg.value : undefined,
}));

// Fired together (not sequentially) - the recommend query only depends on `slug` plus rider
// profile/garage/preference state above, none of which depends on the route lookup resolving first.
const [{ data: routeData, error: routeError }, { data: recommendData, status, refresh: refreshRecommendations }] = await Promise.all([
  useFetch(() => `/api/routes/${slug.value}`),
  useFetch(() => `/api/recommend/${slug.value}`, { query: recommendQuery, watch: false }),
]);
if (routeError.value) throw createError({ statusCode: 404, statusMessage: "Route not found", fatal: true });

useSeoMeta({
  title: () => routeData.value ? `Best Bike for ${routeData.value.name} - Zwift Best Bike` : "Zwift Best Bike",
  description: () => routeData.value
    ? `Find the fastest bike and wheel combo for ${routeData.value.name} in ${routeData.value.worldName}. Distance, elevation and surface-aware recommendations.`
    : undefined,
  ogTitle: () => routeData.value ? routeData.value.name : undefined,
  ogDescription: () => routeData.value
    ? `Find the fastest bike and wheel combo for ${routeData.value.name} in ${routeData.value.worldName}.`
    : undefined,
  ogImage: () => routeData.value ? getWorldImageUrl(routeData.value.world) : undefined,
  twitterImage: () => routeData.value ? getWorldImageUrl(routeData.value.world) : undefined
});

onMounted(() => {
  loadGarage();
  loadRiderProfile();
  loadPreferences();
  pendingWeightKg.value = weightKg.value;
  pendingHeightCm.value = heightCm.value;
  pendingWkg.value = wkg.value;
  pendingRiders.value = tttRiders.value;
  pendingClimbWkg.value = tttClimbWkg.value ?? wkg.value;
});

const routeTotals = computed(() => routeData.value ? computeRouteTotals(routeData.value, laps.value) : undefined);
const climbOccurrences = computed(() => routeData.value ? expandClimbsForLaps(routeData.value, laps.value) : []);
const sprintOccurrences = computed(() => routeData.value ? expandSprintsForLaps(routeData.value, laps.value) : []);

const pendingWeightKg = ref(weightKg.value);
const pendingHeightCm = ref(heightCm.value);
const pendingWkg = ref(wkg.value);
// Committing weight holds FTP constant and re-derives W/kg (see `setWeightKg`),
// so the power slider follows through its own `watch` below.
const commitWeight = () => setWeightKg(pendingWeightKg.value);
const commitHeight = () => setHeightCm(pendingHeightCm.value);
const commitWkg = () => setWkg(pendingWkg.value);
watch(weightKg, (value) => { pendingWeightKg.value = value; });
watch(heightCm, (value) => { pendingHeightCm.value = value; });
watch(wkg, (value) => { pendingWkg.value = value; });

// Seeded from the rider's normal power, then left alone: there is deliberately
// no `watch(wkg, ...)` here, so moving the Power slider never drags the team's
// climb pace with it. Until it is committed the profile keeps it `undefined`
// and the query omits it entirely, which is what makes "not set" mean "ride
// the climbs at your normal power" rather than "ride them at this number".
const pendingClimbWkg = ref(tttClimbWkg.value ?? wkg.value);
const commitClimbWkg = () => setTttClimbWkg(pendingClimbWkg.value);
watch(tttClimbWkg, (value) => { if (value !== undefined) pendingClimbWkg.value = value; });

const pendingRiders = ref(tttRiders.value);
const commitRiders = () => setTttRiders(pendingRiders.value);
watch(tttRiders, (value) => { pendingRiders.value = value; });

const loadedCombos = ref<any[]>([]);
const hasMore = ref(true);
const loadingMore = ref(false);
watch(recommendData, (data) => {
  if (!data) return;
  loadedCombos.value = data.combos ?? [];
  hasMore.value = data.pagination?.hasMore ?? false;
}, { immediate: true });

// `recommendData` keeps its previous value while a refetch (filter/rider
// profile/laps change) is in flight, so `status === 'pending'` alone can't
// tell a genuine first load (nothing to show yet) apart from a refresh of
// already-visible results (show stale cards + a subtle "updating" hint).
const isFirstLoad = computed(() => status.value === "pending" && !recommendData.value);
const isRefreshingCombos = computed(() => status.value === "pending" && !!recommendData.value);

async function refreshFirstPage() {
  // Keep the current results mounted while the new recommendation request is
  // running. Clearing the cards first makes the page temporarily much shorter,
  // which causes the browser to clamp scrollY back to the top. The refreshed
  // results will replace these in-place once the request completes.
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

watch([weightKg, heightCm, wkg, laps, myBikesOnly, verifiedOnly, categoryFilter, bikeSearchDebounced, draftMode, tttRiders, tttClimbWkg], () => { refreshFirstPage(); });
watch(owned, () => { refreshFirstPage(); }, { deep: true });
watch(ownedWheels, () => { refreshFirstPage(); }, { deep: true });

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
const tttSavingText = computed(() => formatTttTimeSaving(physicsInfo.value?.ttt));
const draftModeOptions = [{ label: "Solo (no draft)", value: "solo" }, { label: "TTT (paceline)", value: "ttt" }] as const;

const faqQuestion = computed(() => routeData.value ? `What's the fastest bike for ${routeData.value.name}?` : undefined);
const faqAnswer = computed(() => {
  if (!routeData.value || !topCombo.value || typeof topCombo.value.finishTimeSec !== "number") return undefined;
  const equipment = topCombo.value.wheelset ? `${topCombo.value.frame.name} with ${topCombo.value.wheelset.name}` : topCombo.value.frame.name;
  const distanceKm = routeTotals.value?.distanceKm ?? routeData.value.distance;
  return `Based on our physics model, the ${equipment} is currently the fastest verified combo for ${routeData.value.name} in ${routeData.value.worldName}, finishing in ${formatDuration(topCombo.value.finishTimeSec)} (~${formatSpeedKmh(distanceKm, topCombo.value.finishTimeSec)}).`;
});

const siteConfig = useSiteConfig();
const requestUrl = useRequestURL();
useHead(() => {
  if (!routeData.value) return {};
  const scripts = [{
    type: "application/ld+json" as const,
    innerHTML: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": siteConfig.url },
        { "@type": "ListItem", "position": 2, "name": routeData.value.name, "item": requestUrl.href }
      ]
    }).replace(/</g, "\\u003c")
  }];
  if (faqAnswer.value) {
    scripts.push({
      type: "application/ld+json" as const,
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [{
          "@type": "Question",
          "name": faqQuestion.value,
          "acceptedAnswer": { "@type": "Answer", "text": faqAnswer.value }
        }]
      }).replace(/</g, "\\u003c")
    });
  }
  return { script: scripts };
});
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
        </div><p v-if="surfaceTimePenaltyText" class="text-xs text-muted sm:text-right">{{ surfaceTimePenaltyText }}</p><p v-if="tttSavingText" class="text-xs text-muted sm:text-right">{{ tttSavingText }}</p></div>
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

    <div v-if="faqAnswer">
      <h2 class="text-lg font-semibold text-highlighted mb-2">{{ faqQuestion }}</h2>
      <p class="text-muted">{{ faqAnswer }}</p>
    </div>

    <RouteSurfaceSpeedProfile
      v-if="topCombo"
      :route="routeData"
      :frame="topCombo.frame"
      :wheelset="topCombo.wheelset"
      :weight-kg="weightKg"
      :height-cm="heightCm"
      :wkg="wkg"
      :draft-mode="draftMode"
      :ttt-riders="tttRiders"
      :ttt-climb-wkg="tttClimbWkg"
    />

    <RacePlanPanel
      v-if="draftMode === 'ttt' && topCombo"
      :route="routeData"
      :laps="laps"
      :weight-kg="weightKg"
      :height-cm="heightCm"
      :wkg="wkg"
      :frame="topCombo.frame"
      :wheelset="topCombo.wheelset"
      :ttt-riders="tttRiders"
      :ttt-climb-wkg="tttClimbWkg"
    />

    <div v-if="routeData.terrain.elevationProfile && routeData.terrain.elevationProfile.length > 1">
      <RouteElevationProfile :route="routeData" :laps="laps" :climbs="climbOccurrences" :sprints="sprintOccurrences" />
    </div>

    <div v-if="climbOccurrences.length || sprintOccurrences.length || routeData.surface.composition" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div v-if="climbOccurrences.length || sprintOccurrences.length" class="lg:col-span-2 space-y-6">
        <div v-if="climbOccurrences.length">
          <h2 class="text-lg font-semibold text-highlighted mb-3">Climbs on this route</h2>
          <RouteClimbs :climbs="climbOccurrences" :route-slug="routeData.slug" />
        </div>
        <div v-if="sprintOccurrences.length">
          <h2 class="text-lg font-semibold text-highlighted mb-3">Sprints on this route</h2>
          <RouteSprints :sprints="sprintOccurrences" :route-slug="routeData.slug" />
        </div>
      </div>
      <div v-if="routeData.surface.composition">
        <h2 class="text-lg font-semibold text-highlighted mb-3">Surface</h2>
        <RouteSurfaceComposition :surface="routeData.surface" />
      </div>
    </div>

    <UAlert v-if="physicsInfo" color="primary" variant="subtle" icon="i-lucide-atom" :title="physicsIsDynamic ? 'Dynamic physics model active' : 'Legacy finish-time model'" :description="physicsInfo.note" />

    <div>
      <h2 class="text-xl font-semibold text-highlighted mb-4">Best bike &amp; wheel combo for this route</h2>
      <div class="flex flex-wrap items-end gap-4 rounded-lg border border-default p-4 mb-6">
        <div class="min-w-48"><label class="block text-xs font-medium text-muted mb-1">Bike category</label><USelectMenu v-model="categoryFilter" value-key="value" :items="categoryOptions" :search-input="false" class="w-52" /></div>
        <div class="min-w-56 flex-1"><label class="block text-xs font-medium text-muted mb-1">Search bikes or wheels</label><UInput v-model="bikeSearch" icon="i-lucide-search" placeholder="e.g. Tarmac, Aethos, Zipp, DICUT..." /></div>
        <div class="flex items-center gap-2"><USwitch :model-value="verifiedOnly" @update:model-value="(value: boolean) => setVerifiedOnly(value)" /><span class="text-sm">Only show verified frames/wheels</span></div>
        <div class="flex items-center gap-2"><USwitch :model-value="myBikesOnly" @update:model-value="(value: boolean) => setMyBikesOnly(value)" /><span class="text-sm">Only show items in my garage</span><ULink to="/garage" class="text-sm text-primary underline">(edit garage)</ULink></div>
      </div>

      <!-- Two fixed rows rather than one wrapping one: the rider's own numbers stay
           on the first, everything about the group on the second. Switching draft
           mode then only fills in the second row's spare width instead of pushing a
           control onto a new line, so the page below barely moves. -->
      <div class="rounded-lg border border-default p-4 mb-6 space-y-4">
        <div class="flex flex-wrap items-end gap-6">
          <div class="w-full sm:w-44"><label class="block text-xs font-medium text-muted mb-1">Rider weight: {{ pendingWeightKg }} kg</label><input v-model.number="pendingWeightKg" type="range" min="40" max="130" step="1" class="w-full cursor-pointer" aria-label="Rider weight in kilograms" @change="commitWeight" /></div>
          <div class="w-full sm:w-56"><label class="block text-xs font-medium text-muted mb-1">Height: {{ pendingHeightCm }} cm</label><input v-model.number="pendingHeightCm" type="range" min="100" max="220" step="1" class="w-full cursor-pointer" aria-label="Rider height" @change="commitHeight" /></div>
          <div class="min-w-64 flex-1"><label class="block text-xs font-medium text-muted mb-1">Power: {{ pendingWkg.toFixed(1) }} W/kg ({{ Math.round(pendingWkg * weightKg) }} W){{ draftMode === "ttt" ? " average" : "" }}</label><input v-model.number="pendingWkg" type="range" min="1" max="6.9" step="0.1" class="w-full cursor-pointer" aria-label="Rider power in watts per kilogram" @change="commitWkg" /></div>
        </div>
        <div class="flex flex-wrap items-end gap-6">
          <div class="w-44"><label class="block text-xs font-medium text-muted mb-1">Draft <UTooltip text="Solo is a lone rider, no draft (how ZwiftInsider's bot tests ride). TTT is a rotating paceline: your power stays YOUR average over a full rotation - you push well above it while pulling and sit below it in the wheels - and the group moves at the speed that combined effort produces."><UIcon name="i-lucide-info" class="size-3 text-muted align-text-bottom" /></UTooltip></label><USelectMenu :model-value="draftMode" value-key="value" :items="[...draftModeOptions]" :search-input="false" @update:model-value="(value: 'solo' | 'ttt') => setDraftMode(value)" /></div>
          <div v-if="draftMode === 'ttt'" class="w-full sm:w-40"><label class="block text-xs font-medium text-muted mb-1">Riders: {{ pendingRiders }} <UTooltip text="Team size in the rotation. Per-position draft stops improving past the 4th wheel, but team size keeps mattering: in a bigger team you spend a smaller share of the time on the front, which is where all the cost is."><UIcon name="i-lucide-info" class="size-3 text-muted align-text-bottom" /></UTooltip></label><input v-model.number="pendingRiders" type="range" :min="TTT_MIN_RIDERS" :max="TTT_MAX_RIDERS" step="1" class="w-full cursor-pointer" aria-label="Number of riders in the paceline" @change="commitRiders" /></div>
          <div v-if="draftMode === 'ttt'" class="w-full sm:w-64"><label class="block text-xs font-medium text-muted mb-1">Team climb power: {{ pendingClimbWkg.toFixed(1) }} W/kg ({{ Math.round(pendingClimbWkg * weightKg) }} W) <UTooltip text="What the team averages on climbs steeper than 3% lasting over ~3.5 minutes, where a paceline breaks up and everyone rides their own pace. Starts at your normal power and stays where you put it - changing the Power slider above never moves it."><UIcon name="i-lucide-info" class="size-3 text-muted align-text-bottom" /></UTooltip></label><input v-model.number="pendingClimbWkg" type="range" :min="TTT_MIN_CLIMB_WKG" :max="TTT_MAX_CLIMB_WKG" step="0.1" class="w-full cursor-pointer" aria-label="Team average power on long climbs in watts per kilogram" @change="commitClimbWkg" /></div>
          <ULink to="/profile" class="text-sm text-primary underline self-center">(edit profile)</ULink>
        </div>
      </div>

      <div v-if="isFirstLoad" class="space-y-4">
        <ComboResultCardSkeleton class="mb-6" />
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4"><ComboResultCardSkeleton /><ComboResultCardSkeleton /></div>
      </div>
      <template v-else>
        <p v-if="isRefreshingCombos" class="flex items-center gap-1.5 text-sm text-muted mb-3"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />Updating results…</p>
        <div class="transition-opacity" :class="{ 'opacity-60 pointer-events-none': isRefreshingCombos }">
          <ComboResultCard v-if="topCombo" :combo="topCombo" :rank="1" :route="routeData" :weight-kg="weightKg" :height-cm="heightCm" :wkg="wkg" :laps="laps" :fastest-time-sec="fastestTimeSec" :owned="owned" :draft-mode="draftMode" :ttt-riders="tttRiders" :ttt-climb-wkg="tttClimbWkg" class="mb-6" />
          <div v-if="restCombos.length" class="grid grid-cols-1 md:grid-cols-2 gap-4"><ComboResultCard v-for="(combo, index) in restCombos" :key="`${combo.frame.id}-${combo.wheelset?.key ?? 'fixed'}`" :combo="combo" :rank="index + 2" :route="routeData" :weight-kg="weightKg" :height-cm="heightCm" :wkg="wkg" :laps="laps" :fastest-time-sec="fastestTimeSec" :owned="owned" :draft-mode="draftMode" :ttt-riders="tttRiders" :ttt-climb-wkg="tttClimbWkg" /></div>
          <p v-else-if="!topCombo" class="text-muted text-center py-10">No bikes match your filters.</p>
        </div>
        <div v-if="hasMore" class="text-center mt-6"><UButton color="neutral" variant="subtle" :loading="loadingMore" @click="showMore">Show more matches</UButton></div>
      </template>
    </div>
  </UContainer>
</template>
