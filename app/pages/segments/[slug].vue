<script setup lang="ts">
import type { BikeCategory, RouteWithMeta } from '../../../shared/types/catalog'
import { TTT_MAX_CLIMB_WKG, TTT_MAX_RIDERS, TTT_MIN_CLIMB_WKG, TTT_MIN_RIDERS } from '#shared/utils/physics/draft'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const preferredRouteSlug = computed(() => typeof route.query.route === 'string' ? route.query.route : undefined)
const { data: segmentData, error: segmentError } = await useFetch(() => `/api/segments/${slug.value}`)
if (segmentError.value) throw createError({ statusCode: 404, statusMessage: 'Segment not found', fatal: true })

useSeoMeta({
  title: () => segmentData.value ? `Best Bike for the ${segmentData.value.name} ${segmentData.value.type} - ZwiftBikes` : 'ZwiftBikes',
  description: () => segmentData.value
    ? `Find the fastest bike and wheel combo for the ${segmentData.value.name} ${segmentData.value.type} in ${segmentData.value.worldName}.`
    : undefined,
  ogTitle: () => segmentData.value ? segmentData.value.name : undefined,
  ogDescription: () => segmentData.value
    ? `Find the fastest bike and wheel combo for the ${segmentData.value.name} ${segmentData.value.type} in ${segmentData.value.worldName}.`
    : undefined,
  // Full object, not just the URL: the app-level default in app.vue emits
  // og:image:width/height/alt, which unhead dedupes per-tag, so replacing
  // only og:image would leave the default image's dimensions attached to
  // this page's world artwork.
  ogImage: () => {
    if (!segmentData.value) return undefined
    const img = getWorldImage(segmentData.value.world)
    return img ? { ...img, alt: `${segmentData.value.worldName} route map` } : undefined
  },
  twitterImage: () => segmentData.value ? getWorldImageUrl(segmentData.value.world) : undefined
})

const { owned, ownedWheels, load: loadGarage } = useGarage()
const { weightKg, heightCm, wkg, defaultUnownedLevel, draftMode, tttRiders, tttClimbWkg, load: loadRiderProfile, setWeightKg, setWkg, setHeightCm, setDraftMode, setTttRiders, setTttClimbWkg } = useRiderProfile()
// `bikeCategory` is bound straight to the control below rather than mirrored
// into a page-local ref - see the equivalent comment in `routes/[slug].vue`.
const { verifiedOnly, myBikesOnly, bikeCategory, load: loadPreferences, setVerifiedOnly, setMyBikesOnly, setBikeCategory } = usePreferences()
onMounted(() => {
  loadGarage()
  loadRiderProfile()
  loadPreferences()
  pendingWeightKg.value = weightKg.value
  pendingHeightCm.value = heightCm.value
  pendingWkg.value = wkg.value
  pendingRiders.value = tttRiders.value
  pendingClimbWkg.value = tttClimbWkg.value ?? wkg.value
})

const bikeSearch = ref('')
const bikeSearchDebounced = ref('')
let bikeSearchDebounceTimer: ReturnType<typeof setTimeout> | undefined
watch(bikeSearch, (value) => { clearTimeout(bikeSearchDebounceTimer); bikeSearchDebounceTimer = setTimeout(() => { bikeSearchDebounced.value = value }, 300) })
const pageSize = 9

const pendingWeightKg = ref(weightKg.value)
const pendingHeightCm = ref(heightCm.value)
const pendingWkg = ref(wkg.value)
// Committing weight holds FTP constant and re-derives W/kg (see `setWeightKg`),
// so the power slider follows through its own `watch` below.
const commitWeight = () => setWeightKg(pendingWeightKg.value)
const commitHeight = () => setHeightCm(pendingHeightCm.value)
const commitWkg = () => setWkg(pendingWkg.value)
watch(weightKg, (value) => { pendingWeightKg.value = value })
watch(heightCm, (value) => { pendingHeightCm.value = value })
watch(wkg, (value) => { pendingWkg.value = value })

// Seeded from the rider's normal power, then left alone - see the equivalent
// comment in `routes/[slug].vue` for why there is deliberately no watch on
// `wkg` here.
const pendingClimbWkg = ref(tttClimbWkg.value ?? wkg.value)
const commitClimbWkg = () => setTttClimbWkg(pendingClimbWkg.value)
watch(tttClimbWkg, (value) => { if (value !== undefined) pendingClimbWkg.value = value })

const pendingRiders = ref(tttRiders.value)
const commitRiders = () => setTttRiders(pendingRiders.value)
watch(tttRiders, (value) => { pendingRiders.value = value })

// A ranking is always a single pass over the segment - there's no fatigue
// model, so which lap a `perLap` segment falls on doesn't change its
// physics, unlike a whole route where lap count changes total distance.
const recommendQuery = computed(() => ({
  search: bikeSearchDebounced.value || undefined,
  // Omitted rather than sent as `all` - see the equivalent comment in `routes/[slug].vue`.
  category: bikeCategory.value !== 'all' ? bikeCategory.value : undefined,
  route: preferredRouteSlug.value,
  limit: pageSize,
  offset: 0,
  // Always sent, never omitted - see the equivalent comment in `routes/[slug].vue`.
  verifiedOnly: verifiedOnly.value ? 'true' : 'false',
  ownedOnly: myBikesOnly.value ? 'true' : undefined,
  owned: Object.keys(owned.value).length ? JSON.stringify(owned.value) : undefined,
  ownedWheels: Object.keys(ownedWheels.value).length ? JSON.stringify(Object.keys(ownedWheels.value)) : undefined,
  defaultUnownedLevel: defaultUnownedLevel.value,
  weightKg: weightKg.value,
  heightCm: heightCm.value,
  wkg: wkg.value,
  // Omitted entirely in solo mode - see the equivalent comment in `routes/[slug].vue`.
  draftMode: draftMode.value === 'ttt' ? 'ttt' : undefined,
  tttRiders: draftMode.value === 'ttt' ? tttRiders.value : undefined,
  tttClimbWkg: draftMode.value === 'ttt' ? tttClimbWkg.value : undefined
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

// `recommendData` keeps its previous value while a refetch (filter/rider
// profile change) is in flight, so `status === 'pending'` alone can't tell a
// genuine first load (nothing to show yet) apart from a refresh of
// already-visible results (show stale cards + a subtle "updating" hint).
const isFirstLoad = computed(() => status.value === 'pending' && !recommendData.value)
const isRefreshingCombos = computed(() => status.value === 'pending' && !!recommendData.value)

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

watch([weightKg, heightCm, wkg, myBikesOnly, verifiedOnly, bikeCategory, bikeSearchDebounced, draftMode, tttRiders, tttClimbWkg], () => { refreshFirstPage() })
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
// Present only when the category filter is hiding a faster combo - see
// `FastestOverallNote` and the endpoint's `fastestOverall` block.
const fastestOverall = computed(() => recommendData.value?.fastestOverall)
const physicsIsDynamic = computed(() => physicsInfo.value?.mode === 'dynamic')
const tttSavingText = computed(() => formatTttTimeSaving(physicsInfo.value?.ttt))
const draftModeOptions = [{ label: 'Solo (no draft)', value: 'solo' }, { label: 'TTT (paceline)', value: 'ttt' }]
// The draft controls sit behind a disclosure. Solo is the default and covers
// almost every visit (a road race is not ridden as a paceline), so the
// paceline inputs stay folded away until someone asks for them - but ANY
// non-solo mode forces the section open, because a draft mode silently
// shifting every finish time on the page with no visible control is worse
// than one extra dropdown. That rule is deliberately written against
// `!== 'solo'` rather than `=== 'ttt'` so a future race/pack-draft mode
// (see `shared/utils/physics/draft.ts`) inherits it for free.
const showDraftControls = ref(false)
const draftControlsOpen = computed(() => showDraftControls.value || draftMode.value !== 'solo')

const faqQuestion = computed(() => segmentData.value ? `What's the fastest bike for the ${segmentData.value.name} ${segmentData.value.type}?` : undefined)
const faqAnswer = computed(() => {
  if (!segmentData.value || !topCombo.value || typeof topCombo.value.finishTimeSec !== 'number') return undefined
  const equipment = topCombo.value.wheelset ? `${topCombo.value.frame.name} with ${topCombo.value.wheelset.name}` : topCombo.value.frame.name
  return `Based on our physics model, the ${equipment} is currently the fastest verified combo for the ${segmentData.value.name} ${segmentData.value.type} in ${segmentData.value.worldName}, finishing in ${formatDuration(topCombo.value.finishTimeSec)} (~${formatSpeedKmh(segmentData.value.lengthKm, topCombo.value.finishTimeSec)}).`
})

const siteConfig = useSiteConfig()
const requestUrl = useRequestURL()
useHead(() => {
  if (!segmentData.value) return {}
  const scripts = [{
    type: 'application/ld+json' as const,
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
        { '@type': 'ListItem', 'position': 2, 'name': segmentData.value.name, 'item': requestUrl.href }
      ]
    }).replace(/</g, '\\u003c')
  }]
  if (faqAnswer.value) {
    scripts.push({
      type: 'application/ld+json' as const,
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        'mainEntity': [{
          '@type': 'Question',
          'name': faqQuestion.value,
          'acceptedAnswer': { '@type': 'Answer', 'text': faqAnswer.value }
        }]
      }).replace(/</g, '\\u003c')
    })
  }
  return { script: scripts }
})

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
          <p
            v-if="tttSavingText"
            class="text-xs text-muted sm:text-right"
          >
            {{ tttSavingText }}
          </p>
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

    <div v-if="faqAnswer">
      <h2 class="text-lg font-semibold text-highlighted mb-2">
        {{ faqQuestion }}
      </h2>
      <p class="text-muted">
        {{ faqAnswer }}
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
            :model-value="bikeCategory"
            value-key="value"
            :items="categoryOptions"
            :search-input="false"
            class="w-52"
            @update:model-value="(value: BikeCategory | 'all') => setBikeCategory(value)"
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

      <!-- Two fixed rows rather than one wrapping one: the rider's own numbers stay
           on the first, everything about the group on the second. Switching draft
           mode then only fills in the second row's spare width instead of pushing a
           control onto a new line, so the page below barely moves. Collapsed, that
           second row is a single opt-in button - see `draftControlsOpen`. -->
      <div class="rounded-lg border border-default p-4 mb-6 space-y-4">
        <div class="flex flex-wrap items-end gap-6">
          <div class="w-full sm:w-44">
            <label class="block text-xs font-medium text-muted mb-1">Rider weight: {{ pendingWeightKg }} kg</label><input
              v-model.number="pendingWeightKg"
              type="range"
              min="40"
              max="130"
              step="1"
              class="w-full cursor-pointer"
              aria-label="Rider weight in kilograms"
              @change="commitWeight"
            >
          </div>
          <div class="w-full sm:w-56">
            <label class="block text-xs font-medium text-muted mb-1">Height: {{ pendingHeightCm }} cm</label><input
              v-model.number="pendingHeightCm"
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
            <label class="block text-xs font-medium text-muted mb-1">Power: {{ pendingWkg.toFixed(1) }} W/kg ({{ Math.round(pendingWkg * weightKg) }} W){{ draftMode === "ttt" ? " average" : "" }}</label><input
              v-model.number="pendingWkg"
              type="range"
              min="1"
              max="6.9"
              step="0.1"
              class="w-full cursor-pointer"
              aria-label="Rider power in watts per kilogram"
              @change="commitWkg"
            >
          </div>
        </div>
        <div class="flex flex-wrap items-end gap-6">
          <UButton
            v-if="!draftControlsOpen"
            color="neutral"
            variant="subtle"
            size="xs"
            icon="i-lucide-users"
            @click="showDraftControls = true"
          >
            Riding this in a group? Add draft
          </UButton>
          <div
            v-if="draftControlsOpen"
            class="w-44"
          >
            <label class="block text-xs font-medium text-muted mb-1">Draft <UTooltip text="Solo is a lone rider, no draft (how ZwiftInsider's bot tests ride). TTT is a rotating paceline: your power stays YOUR average over a full rotation - you push well above it while pulling and sit below it in the wheels - and the group moves at the speed that combined effort produces."><UIcon
              name="i-lucide-info"
              class="size-3 text-muted align-text-bottom"
            /></UTooltip></label><USelectMenu
              :model-value="draftMode"
              value-key="value"
              :items="draftModeOptions"
              :search-input="false"
              @update:model-value="(value: string) => setDraftMode(value === 'ttt' ? 'ttt' : 'solo')"
            />
          </div>
          <div
            v-if="draftMode === 'ttt'"
            class="w-full sm:w-40"
          >
            <label class="block text-xs font-medium text-muted mb-1">Riders: {{ pendingRiders }} <UTooltip text="Team size in the rotation. Per-position draft stops improving past the 4th wheel, but team size keeps mattering: in a bigger team you spend a smaller share of the time on the front, which is where all the cost is."><UIcon
              name="i-lucide-info"
              class="size-3 text-muted align-text-bottom"
            /></UTooltip></label><input
              v-model.number="pendingRiders"
              type="range"
              :min="TTT_MIN_RIDERS"
              :max="TTT_MAX_RIDERS"
              step="1"
              class="w-full cursor-pointer"
              aria-label="Number of riders in the paceline"
              @change="commitRiders"
            >
          </div>
          <div
            v-if="draftMode === 'ttt'"
            class="w-full sm:w-64"
          >
            <label class="block text-xs font-medium text-muted mb-1">Team climb power: {{ pendingClimbWkg.toFixed(1) }} W/kg ({{ Math.round(pendingClimbWkg * weightKg) }} W) <UTooltip text="What the team averages on climbs steeper than 3% lasting over ~3.5 minutes, where a paceline breaks up and everyone rides their own pace. Starts at your normal power and stays where you put it - changing the Power slider above never moves it."><UIcon
              name="i-lucide-info"
              class="size-3 text-muted align-text-bottom"
            /></UTooltip></label><input
              v-model.number="pendingClimbWkg"
              type="range"
              :min="TTT_MIN_CLIMB_WKG"
              :max="TTT_MAX_CLIMB_WKG"
              step="0.1"
              class="w-full cursor-pointer"
              aria-label="Team average power on long climbs in watts per kilogram"
              @change="commitClimbWkg"
            >
          </div>
          <ULink
            to="/profile"
            class="text-sm text-primary underline self-center"
          >(edit profile)</ULink>
        </div>
      </div>

      <div
        v-if="isFirstLoad"
        class="space-y-4"
      >
        <ComboResultCardSkeleton class="mb-6" />
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ComboResultCardSkeleton />
          <ComboResultCardSkeleton />
        </div>
      </div>
      <template v-else>
        <p
          v-if="isRefreshingCombos"
          class="flex items-center gap-1.5 text-sm text-muted mb-3"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-4 animate-spin"
          />Updating results…
        </p>
        <FastestOverallNote
          v-if="fastestOverall"
          :fastest-overall="fastestOverall"
          @show-all="setBikeCategory('all')"
        />
        <div
          class="transition-opacity"
          :class="{ 'opacity-60 pointer-events-none': isRefreshingCombos }"
        >
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
        </div>
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
