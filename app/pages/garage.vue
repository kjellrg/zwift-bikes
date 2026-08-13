<script setup lang="ts">
import type { ClassifiedBikeFrame, Wheelset } from '../../shared/types/catalog'

const {
  owned,
  ownedWheels,
  load,
  setOwned,
  isOwned,
  setWheelOwned,
  isWheelOwned
} = useGarage()

onMounted(() => {
  load()
})

// Everything on this page renders from localStorage, so a crawler only ever
// sees an empty shell - thin content with nothing to rank for. Keep it out
// of the index, but still follow its links out. `useRobotsRule` (from
// @nuxtjs/robots) rather than `useSeoMeta`, so this owns the single robots
// meta tag the module manages instead of racing it, and sets the matching
// X-Robots-Tag header too.
useRobotsRule('noindex, follow')

const search = ref('')
const searchDebounced = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounced.value = value
  }, 300)
})

const query = computed(() => ({
  search: searchDebounced.value || undefined
}))

const { data, status } = await useFetch('/api/bikes', { query })

const ownedFramesOnly = ref(false)
const frames = computed<ClassifiedBikeFrame[]>(() => {
  const all = data.value?.frames ?? []
  return ownedFramesOnly.value ? all.filter(f => isOwned(f.id)) : all
})

const levelOptions = [1, 2, 3, 4, 5].map(level => ({
  label: `Level ${level}`,
  value: level
}))

function toggleOwned(frame: ClassifiedBikeFrame, value: boolean) {
  setOwned(frame.id, value ? 1 : null)
}

function updateLevel(frameId: number, level: number) {
  setOwned(frameId, level)
}

const ownedCount = computed(() => Object.keys(owned.value).length)

const wheelSearch = ref('')
const wheelSearchDebounced = ref('')
let wheelSearchDebounceTimer: ReturnType<typeof setTimeout> | undefined
watch(wheelSearch, (value) => {
  clearTimeout(wheelSearchDebounceTimer)
  wheelSearchDebounceTimer = setTimeout(() => {
    wheelSearchDebounced.value = value
  }, 300)
})

const wheelQuery = computed(() => ({
  search: wheelSearchDebounced.value || undefined
}))

const { data: wheelData, status: wheelStatus } = await useFetch(
  '/api/wheelsets',
  { query: wheelQuery }
)

const ownedWheelsetsOnly = ref(false)
const wheelsets = computed<Wheelset[]>(() => {
  const all = wheelData.value?.wheelsets ?? []
  return ownedWheelsetsOnly.value
    ? all.filter(w => isWheelOwned(w.key))
    : all
})

function toggleWheelOwned(wheelset: Wheelset, value: boolean) {
  setWheelOwned(wheelset.key, value)
}

const ownedWheelCount = computed(() => Object.keys(ownedWheels.value).length)

const tabItems = [
  { label: 'Bikes', value: 'bikes', icon: 'i-lucide-bike' },
  { label: 'Wheels', value: 'wheels', icon: 'i-lucide-circle-dot' }
]
const activeTab = ref('bikes')
</script>

<template>
  <UContainer class="py-10 space-y-8">
    <div>
      <h1 class="text-3xl font-bold text-highlighted">
        My Garage
      </h1>
      <p class="text-muted mt-1">
        Mark which bike frames and wheels you own (and each frame's current
        upgrade level - 1 = just unlocked, 5 = fully upgraded). Route
        recommendations can then be limited to just your equipment, using their
        real per-level performance.
      </p>
    </div>

    <UAlert
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="Stored on this device only"
      description="Your garage is saved in this browser's local storage - there's no account system, so it won't follow you to another device or browser."
    />

    <UTabs
      v-model="activeTab"
      :items="tabItems"
    >
      <template #content="{ item }">
        <div
          v-if="item.value === 'bikes'"
          class="space-y-4 mt-4"
        >
          <div
            class="flex flex-wrap items-end gap-4 rounded-lg border border-default p-4"
          >
            <div class="min-w-56 flex-1">
              <label class="block text-xs font-medium text-muted mb-1">Search bikes</label>
              <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="e.g. Tarmac, Aethos, Grail..."
              />
            </div>
            <UBadge
              color="primary"
              variant="subtle"
            >
              {{ ownedCount }} bike{{ ownedCount === 1 ? "" : "s" }} owned
            </UBadge>
            <div class="flex items-center gap-2">
              <USwitch v-model="ownedFramesOnly" />
              <span class="text-sm">Only show bikes I own</span>
            </div>
          </div>

          <div
            v-if="status === 'pending'"
            class="text-center py-10 text-muted"
          >
            Loading bikes...
          </div>

          <div
            v-else
            class="space-y-2"
          >
            <div
              v-for="frame in frames"
              :key="frame.id"
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default p-3"
            >
              <div class="flex items-center gap-3">
                <USwitch
                  :model-value="isOwned(frame.id)"
                  @update:model-value="
                    (value: boolean) => toggleOwned(frame, value)
                  "
                />
                <div>
                  <p class="font-medium text-highlighted">
                    {{ frame.name }}
                  </p>
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <BikeCategoryBadge :category="frame.category" />
                    <UBadge
                      v-if="frame.style"
                      color="neutral"
                      variant="subtle"
                    >
                      {{ frame.style }}
                    </UBadge>
                  </div>
                </div>
              </div>

              <USelectMenu
                v-if="isOwned(frame.id)"
                :model-value="owned[frame.id]"
                value-key="value"
                :items="levelOptions"
                :search-input="false"
                class="w-32"
                @update:model-value="
                  (level: number) => updateLevel(frame.id, level)
                "
              />
            </div>

            <p
              v-if="!frames.length"
              class="text-muted text-center py-10"
            >
              No bikes match your search.
            </p>
          </div>
        </div>

        <div
          v-else
          class="space-y-4 mt-4"
        >
          <div
            class="flex flex-wrap items-end gap-4 rounded-lg border border-default p-4"
          >
            <div class="min-w-56 flex-1">
              <label class="block text-xs font-medium text-muted mb-1">Search wheels</label>
              <UInput
                v-model="wheelSearch"
                icon="i-lucide-search"
                placeholder="e.g. Zipp, DICUT, Aeolus..."
              />
            </div>
            <UBadge
              color="primary"
              variant="subtle"
            >
              {{ ownedWheelCount }} wheelset{{
                ownedWheelCount === 1 ? "" : "s"
              }}
              owned
            </UBadge>
            <div class="flex items-center gap-2">
              <USwitch v-model="ownedWheelsetsOnly" />
              <span class="text-sm">Only show wheels I own</span>
            </div>
          </div>

          <div
            v-if="wheelStatus === 'pending'"
            class="text-center py-10 text-muted"
          >
            Loading wheels...
          </div>

          <div
            v-else
            class="space-y-2"
          >
            <div
              v-for="wheelset in wheelsets"
              :key="wheelset.key"
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default p-3"
            >
              <div class="flex items-center gap-3">
                <USwitch
                  :model-value="isWheelOwned(wheelset.key)"
                  @update:model-value="
                    (value: boolean) => toggleWheelOwned(wheelset, value)
                  "
                />
                <div>
                  <p class="font-medium text-highlighted">
                    {{ wheelset.name }}
                  </p>
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <UBadge
                      color="neutral"
                      variant="subtle"
                    >
                      {{ WHEEL_CATEGORY_LABELS[wheelset.front.category] }}
                    </UBadge>
                  </div>
                </div>
              </div>
            </div>

            <p
              v-if="!wheelsets.length"
              class="text-muted text-center py-10"
            >
              No wheels match your search.
            </p>
          </div>
        </div>
      </template>
    </UTabs>
  </UContainer>
</template>
