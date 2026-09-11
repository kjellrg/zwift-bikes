<script setup lang="ts">
import type { ClassifiedBikeFrame, Wheelset } from '../../shared/types/catalog'

// Shared by `GarageModal.vue` (in-app UX) and `pages/garage.vue` (the
// deep-linkable copy). Keep this component free of modal-specific markup so
// both hosts can style their own heading/container - and free of
// `useRobotsRule`, which sets a site-global robots rule plus an X-Robots-Tag
// header and would mark whatever page the modal happens to be open on as
// noindex. That call stays on `pages/garage.vue`.

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

// Deliberately NOT awaited (both fetches): a top-level `await` only works
// under a Suspense boundary, which `NuxtPage` provides but a `UModal`
// mounted from `app.vue` does not. Unawaited, `status` starts at `'idle'`
// instead of going straight to a settled value, which is why
// `garageListStatus` counts `'idle'` as loading too - otherwise the "no
// bikes match" empty state flashes before the first request is even in
// flight.
const { data, status, refresh } = useFetch('/api/bikes', { query })

const ownedFramesOnly = ref(false)
const frames = computed<ClassifiedBikeFrame[]>(() => {
  const all = data.value?.frames ?? []
  return ownedFramesOnly.value ? all.filter(f => isOwned(f.id)) : all
})

const levelOptions = [0, 1, 2, 3, 4, 5].map(level => ({
  label: level === 0 ? 'Stage 0 (stock)' : `Stage ${level}`,
  value: level
}))

// Added at the rider's default stage for unowned bikes - the same stage the
// result cards' quick-add uses and the stage unowned bikes are scored at, so
// ticking a bike here never moves it in the ranking. This used to add at
// Stage 0 while the card added at the default: the same action persisted a
// different stage depending on where it was clicked. The stage picker
// alongside is there for riders who haven't upgraded yet.
const { defaultUnownedLevel } = useRiderProfile()
function toggleOwned(frame: ClassifiedBikeFrame, value: boolean) {
  setOwned(frame.id, value ? defaultUnownedLevel.value : null)
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

const { data: wheelData, status: wheelStatus, refresh: refreshWheels } = useFetch(
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

// What each tab shows instead of its rows, if anything - one rule for both,
// so a failed fetch can never read as "nothing matched" on one tab and as
// something else on the other.
const frameListStatus = computed(() => garageListStatus({
  status: status.value,
  ownedOnly: ownedFramesOnly.value,
  ownsCollection: ownedCount.value > 0,
  visible: frames.value.length
}))
const wheelListStatus = computed(() => garageListStatus({
  status: wheelStatus.value,
  ownedOnly: ownedWheelsetsOnly.value,
  ownsCollection: ownedWheelCount.value > 0,
  visible: wheelsets.value.length
}))

/**
 * Why a tab with "only show what I own" on has nothing in it, read from BOTH
 * halves of the garage: with wheels owned and no frames, "my garage only"
 * still restricts the wheels, and with nothing owned at all it restricts
 * nothing. Garage fallback (see `CONTEXT.md`) is what the ranking pages will
 * actually do, and `garageFallback` is the same reader the equipment filters
 * state it with.
 */
const fallback = computed(() => garageFallback({
  frames: ownedCount.value > 0,
  wheels: ownedWheelCount.value > 0
}))
const frameEmptyNote = computed(() => fallback.value === 'wheelsOnly'
  ? 'You haven\'t marked any bikes as owned. "My garage only" ranks every frame against your wheels until you do.'
  : 'You haven\'t marked any bikes as owned. Your garage is empty, so "my garage only" shows all equipment.')
const wheelEmptyNote = computed(() => fallback.value === 'framesOnly'
  ? 'You haven\'t marked any wheels as owned. "My garage only" ranks your frames against every wheel until you do.'
  : 'You haven\'t marked any wheels as owned. Your garage is empty, so "my garage only" shows all equipment.')

// The two search boxes had a label each and no association with the input
// under it, so neither box had an accessible name at all - the same gap the
// profile's controls had.
const bikeSearchId = useId()
const wheelSearchId = useId()

const tabItems = [
  { label: 'Bikes', value: 'bikes', icon: 'i-lucide-bike' },
  { label: 'Wheels', value: 'wheels', icon: 'i-lucide-circle-dot' }
]
const activeTab = ref('bikes')
</script>

<template>
  <div class="space-y-8">
    <p class="text-muted mt-1">
      Mark which bike frames and wheels you own (and each frame's current
      upgrade stage - 0 = stock, just purchased, 5 = fully upgraded). Route
      recommendations can then be limited to just your equipment, using their
      real per-stage performance.
    </p>

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
              <label
                :for="bikeSearchId"
                class="block text-xs font-medium text-muted mb-1"
              >Search bikes</label>
              <UInput
                :id="bikeSearchId"
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
              <USwitch
                v-model="ownedFramesOnly"
                aria-label="Only show bikes I own"
              />
              <span class="text-sm">Only show bikes I own</span>
            </div>
          </div>

          <!-- Always in the DOM, filled only while the catalog is on its way:
               a live region that appears along with the text it holds is
               announced by nothing (the lesson `DiscoveryStatus` carries). -->
          <p
            class="sr-only"
            role="status"
          >
            <template v-if="frameListStatus === 'loading'">
              Loading bikes…
            </template>
          </p>

          <div
            v-if="frameListStatus === 'loading'"
            class="space-y-2"
          >
            <GarageRowSkeleton
              v-for="n in 6"
              :key="n"
              stage
            />
          </div>

          <!-- A catalog that never arrived is its own answer. Without this
               the garage said "No bikes match your search." about a failed
               request, and the search was the one thing that hadn't failed. -->
          <p
            v-else-if="frameListStatus === 'failed'"
            class="flex flex-wrap items-center justify-center gap-x-2 py-10 text-muted"
            role="alert"
          >
            <UIcon
              name="i-lucide-refresh-cw-off"
              class="size-4 shrink-0"
            />Couldn't load the bike catalog.
            <UButton
              color="neutral"
              variant="link"
              size="xs"
              class="px-0"
              @click="refresh()"
            >
              Try again
            </UButton>
          </p>

          <div
            v-else-if="frameListStatus === 'emptyCollection'"
            class="flex flex-col items-center gap-2 py-10 text-center text-muted"
          >
            <p>{{ frameEmptyNote }}</p>
            <UButton
              color="neutral"
              variant="subtle"
              size="sm"
              @click="ownedFramesOnly = false"
            >
              Show all bikes
            </UButton>
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
              <!-- The name column must be allowed to shrink (`min-w-0`) and
                   the name itself to break: a flex child otherwise refuses to
                   go narrower than its longest unbreakable word, and the
                   catalog's longest frame names pushed the stage select out
                   through the panel's edge on a phone. -->
              <div class="flex min-w-0 flex-1 items-center gap-3">
                <USwitch
                  :model-value="isOwned(frame.id)"
                  :aria-label="`Mark ${frame.name} as owned`"
                  @update:model-value="
                    (value: boolean) => toggleOwned(frame, value)
                  "
                />
                <div class="min-w-0">
                  <p class="font-medium text-highlighted break-words">
                    {{ frame.name }}
                  </p>
                  <div class="flex flex-wrap items-center gap-1.5 mt-0.5">
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

              <UTooltip
                v-if="isOwned(frame.id)"
                :text="
                  frame.confidence === 'estimated'
                    ? 'ZwiftInsider doesn\'t bot-test this frame, so there are no per-stage numbers to apply - its upgrade stage can\'t change its estimate'
                    : 'This bike\'s current upgrade stage (0 = stock, just purchased, 5 = fully upgraded)'
                "
              >
                <USelectMenu
                  :model-value="owned[frame.id]"
                  :disabled="frame.confidence === 'estimated'"
                  value-key="value"
                  :items="levelOptions"
                  :search-input="false"
                  class="w-32"
                  :aria-label="`Upgrade stage for ${frame.name}`"
                  @update:model-value="
                    (level: number) => updateLevel(frame.id, level)
                  "
                />
              </UTooltip>
            </div>

            <p
              v-if="frameListStatus === 'noMatch'"
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
              <label
                :for="wheelSearchId"
                class="block text-xs font-medium text-muted mb-1"
              >Search wheels</label>
              <UInput
                :id="wheelSearchId"
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
              <USwitch
                v-model="ownedWheelsetsOnly"
                aria-label="Only show wheels I own"
              />
              <span class="text-sm">Only show wheels I own</span>
            </div>
          </div>

          <p
            class="sr-only"
            role="status"
          >
            <template v-if="wheelListStatus === 'loading'">
              Loading wheels…
            </template>
          </p>

          <div
            v-if="wheelListStatus === 'loading'"
            class="space-y-2"
          >
            <GarageRowSkeleton
              v-for="n in 6"
              :key="n"
            />
          </div>

          <p
            v-else-if="wheelListStatus === 'failed'"
            class="flex flex-wrap items-center justify-center gap-x-2 py-10 text-muted"
            role="alert"
          >
            <UIcon
              name="i-lucide-refresh-cw-off"
              class="size-4 shrink-0"
            />Couldn't load the wheel catalog.
            <UButton
              color="neutral"
              variant="link"
              size="xs"
              class="px-0"
              @click="refreshWheels()"
            >
              Try again
            </UButton>
          </p>

          <div
            v-else-if="wheelListStatus === 'emptyCollection'"
            class="flex flex-col items-center gap-2 py-10 text-center text-muted"
          >
            <p>{{ wheelEmptyNote }}</p>
            <UButton
              color="neutral"
              variant="subtle"
              size="sm"
              @click="ownedWheelsetsOnly = false"
            >
              Show all wheels
            </UButton>
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
              <div class="flex min-w-0 flex-1 items-center gap-3">
                <USwitch
                  :model-value="isWheelOwned(wheelset.key)"
                  :aria-label="`Mark ${wheelset.name} as owned`"
                  @update:model-value="
                    (value: boolean) => toggleWheelOwned(wheelset, value)
                  "
                />
                <div class="min-w-0">
                  <p class="font-medium text-highlighted break-words">
                    {{ wheelset.name }}
                  </p>
                  <div class="flex flex-wrap items-center gap-1.5 mt-0.5">
                    <UBadge
                      color="neutral"
                      variant="subtle"
                    >
                      {{ WHEEL_CATEGORY_LABELS[wheelset.rear.category] }}
                    </UBadge>
                  </div>
                </div>
              </div>
            </div>

            <p
              v-if="wheelListStatus === 'noMatch'"
              class="text-muted text-center py-10"
            >
              No wheels match your search.
            </p>
          </div>
        </div>
      </template>
    </UTabs>
  </div>
</template>
