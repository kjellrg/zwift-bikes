<script setup lang="ts">
import type { ComboScore } from '../../../shared/types/catalog'
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { geometryForSegment } from '#shared/utils/physics/routeGeometry'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const { data: segmentData, error: segmentError } = await useFetch(() => `/api/segments/${slug.value}`)
if (segmentError.value) throw createError({ statusCode: 404, statusMessage: 'Segment not found', fatal: true })

// The synthetic segment-as-route the server ranks against - carries the
// segment's sliced elevation profile and surface breakdown (see
// `routeWithMetaForSegment`). Positional segments on a measured host get a
// real profile; membership segments don't, and the chart hides itself.
const segmentRoute = computed(() => segmentData.value?.route)

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
// Read-only here: the controls themselves live in `RiderProfileControls` /
// `BikeFilterControls` - see the equivalent comment in `routes/[slug].vue`.
const { weightKg, heightCm, powerW, sprintPowerW, defaultUnownedLevel, draftMode, tttRiders, tttClimbWkg } = useRiderProfile()
const { verifiedOnly, myBikesOnly, bikeCategory, includeHaloBikes, setBikeCategory, setIncludeHaloBikes } = usePreferences()
onMounted(() => {
  loadGarage()
})

// Sprint segments rank at the rider's separate sprint power (see
// `sprintPowerW` in `useRiderProfile`); everything else at their normal
// power. `segmentData` resolves in setup (awaited fetch above), so this is
// stable by the time the controls mount.
const isSprint = computed(() => segmentData.value?.type === 'sprint')
const activePowerW = computed(() => isSprint.value ? sprintPowerW.value : powerW.value)

const bikeSearch = ref('')
const bikeSearchDebounced = ref('')
let bikeSearchDebounceTimer: ReturnType<typeof setTimeout> | undefined
watch(bikeSearch, (value) => {
  clearTimeout(bikeSearchDebounceTimer)
  bikeSearchDebounceTimer = setTimeout(() => {
    bikeSearchDebounced.value = value
  }, 300)
})
const pageSize = 9

// A ranking is always a single pass over the segment - there's no fatigue
// model, so which lap a `perLap` segment falls on doesn't change its
// physics, unlike a whole route where lap count changes total distance.
const recommendQuery = computed(() => ({
  search: bikeSearchDebounced.value || undefined,
  // Omitted rather than sent as `all` - see the equivalent comment in `routes/[slug].vue`.
  category: bikeCategory.value !== 'all' ? bikeCategory.value : undefined,
  limit: pageSize,
  offset: 0,
  // Always sent, never omitted - see the equivalent comment in `routes/[slug].vue`.
  verifiedOnly: verifiedOnly.value ? 'true' : 'false',
  // Always sent - the endpoint's default is include, the preference's is
  // exclude (see `usePreferences`).
  includeHalo: includeHaloBikes.value ? 'true' : 'false',
  ownedOnly: myBikesOnly.value ? 'true' : undefined,
  owned: Object.keys(owned.value).length ? JSON.stringify(owned.value) : undefined,
  ownedWheels: Object.keys(ownedWheels.value).length ? JSON.stringify(Object.keys(ownedWheels.value)) : undefined,
  defaultUnownedLevel: defaultUnownedLevel.value,
  weightKg: weightKg.value,
  heightCm: heightCm.value,
  powerW: activePowerW.value,
  // Omitted entirely in solo mode - see the equivalent comment in `routes/[slug].vue`.
  draftMode: draftMode.value === 'solo' ? undefined : draftMode.value,
  tttRiders: draftMode.value === 'ttt' ? tttRiders.value : undefined,
  tttClimbWkg: draftMode.value === 'ttt' ? tttClimbWkg.value : undefined
}))
const { data: recommendData, status, refresh: refreshRecommendations, error: recommendError } = await useFetch(() => `/api/recommend/segments/${slug.value}`, { query: recommendQuery, watch: false })
useRefetchNotice(recommendError, status, refreshRecommendations)

const loadedCombos = ref<ComboScore[]>([])
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

watch([weightKg, heightCm, powerW, sprintPowerW, myBikesOnly, verifiedOnly, includeHaloBikes, bikeCategory, bikeSearchDebounced, draftMode, tttRiders, tttClimbWkg], () => refreshFirstPage())
watch(owned, () => refreshFirstPage(), { deep: true })
watch(ownedWheels, () => refreshFirstPage(), { deep: true })

const combos = computed(() => loadedCombos.value)
const topCombo = computed(() => combos.value[0])
const restCombos = computed(() => combos.value.slice(1))
const fastestTimeSec = computed(() => {
  const times = combos.value.map(c => c.finishTimeSec).filter((t): t is number => typeof t === 'number')
  return times.length ? Math.min(...times) : undefined
})
const physicsInfo = computed(() => recommendData.value?.physics)
// Present only when the category filter is hiding a faster combo - see
// `FastestOverallNote` and the endpoint's `fastestOverall` block.
const fastestOverall = computed(() => recommendData.value?.fastestOverall)
const physicsIsDynamic = computed(() => physicsInfo.value?.mode === 'dynamic')
const tttSavingText = computed(() => formatTttTimeSaving(physicsInfo.value?.ttt))
const raceSavingText = computed(() => formatRaceTimeSaving(physicsInfo.value?.race))

// Whether the team climb pace control is worth showing - see the
// `hasLongClimb` prop on `RiderProfileControls`. Keyed on the rider's NORMAL
// power, never on `tttClimbWkg`, so the climb pace can't decide its own
// slider's visibility. The empty surface list is deliberate: it only feeds
// the simulator's Crr, and climb detection reads nothing but the geometry's
// points - which must be the same geometry the endpoint simulates
// (measured profile when the host route has one, 2-point line otherwise),
// or this slider's visibility diverges from the actual sim.
const hasLongClimb = computed(() => segmentData.value
  ? detectLongClimbBlocks(geometryForSegment(segmentData.value.slug, segmentData.value.lengthKm, segmentData.value.elevationM, [], segmentRoute.value?.terrain.elevationProfile), powerW.value, weightKg.value).length > 0
  : true)

const faqQuestion = computed(() => segmentData.value ? `What's the fastest bike for the ${segmentData.value.name} ${segmentData.value.type}?` : undefined)
const faqAnswer = computed(() => {
  if (!segmentData.value || !topCombo.value || typeof topCombo.value.finishTimeSec !== 'number') return undefined
  const equipment = topCombo.value.wheelset ? `${topCombo.value.frame.name} with ${topCombo.value.wheelset.name}` : topCombo.value.frame.name
  return `Based on our physics model, the ${equipment} is currently the fastest verified combo for the ${segmentData.value.name} ${segmentData.value.type} in ${segmentData.value.worldName}, finishing in ${formatDuration(topCombo.value.finishTimeSec)} (~${formatSpeedKmh(segmentData.value.lengthKm, topCombo.value.finishTimeSec)}).`
})

const siteConfig = useSiteConfig()
const canonicalUrl = useCanonicalUrl()
useHead(() => {
  if (!segmentData.value) return {}
  const scripts = [{
    type: 'application/ld+json' as const,
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': siteConfig.url },
        { '@type': 'ListItem', 'position': 2, 'name': segmentData.value.name, 'item': canonicalUrl.value }
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
            <SurfaceBadges
              v-if="segmentRoute"
              :surface="segmentRoute.surface"
            />
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
          <p
            v-if="raceSavingText"
            class="text-xs text-muted sm:text-right"
          >
            {{ raceSavingText }}
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
      <div
        v-if="segmentRoute?.terrain.elevationProfile && segmentRoute.terrain.elevationProfile.length > 1"
        class="mt-6"
      >
        <RouteElevationProfile
          :route="segmentRoute"
          :laps="1"
        />
      </div>
      <div
        v-if="segmentRoute?.surface.composition"
        class="mt-6"
      >
        <h2 class="text-lg font-semibold text-highlighted mb-3">
          Surface
        </h2>
        <RouteSurfaceComposition :surface="segmentRoute.surface" />
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
      <p
        v-if="segmentData.placement === 'membership'"
        class="mt-2 text-xs text-muted"
      >
        The exact position of this segment along its host routes isn't in our route data, so length and grade come from the segment's own record, and the surface estimate is borrowed from the host route's overall mix.
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

    <PhysicsNote
      v-if="physicsInfo"
      :mode="physicsInfo.mode"
      :summary="physicsInfo.summary"
      :note="physicsInfo.note"
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
      <RecommendDataNotice />
      <BikeFilterControls
        v-model:search="bikeSearch"
        class="mb-6"
      />

      <RiderProfileControls
        :has-long-climb="hasLongClimb"
        :sprint-power="isSprint"
        class="mb-6"
      />

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
          @include-halo="setIncludeHaloBikes(true)"
        />
        <div
          class="transition-opacity"
          :class="{ 'opacity-60 pointer-events-none': isRefreshingCombos }"
        >
          <ComboResultCard
            v-if="topCombo"
            :combo="topCombo"
            :rank="1"
            :route="segmentRoute"
            :weight-kg="weightKg"
            :height-cm="heightCm"
            :power-w="activePowerW"
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
              :route="segmentRoute"
              :weight-kg="weightKg"
              :height-cm="heightCm"
              :power-w="activePowerW"
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
        <ReportDataLink :item="segmentData?.name" />
      </template>
    </div>
  </UContainer>
</template>
