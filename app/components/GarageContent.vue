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

// The last catalog the list drew, kept through the next search's request
// rather than read straight off `data`: the rows stay mounted, so a stage
// menu opened while the rider is still typing is not closed under them.
const shownFrames = shallowRef<ClassifiedBikeFrame[]>()
watch(data, (value) => {
  if (value) shownFrames.value = value.frames
}, { immediate: true })

const ownedFramesOnly = ref(false)
const frames = computed<ClassifiedBikeFrame[]>(() => {
  const all = shownFrames.value ?? []
  return ownedFramesOnly.value ? all.filter(f => isOwned(f.id)) : all
})

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

// Kept through a search's request, as the frames are.
const shownWheelsets = shallowRef<Wheelset[]>()
watch(wheelData, (value) => {
  if (value) shownWheelsets.value = value.wheelsets
}, { immediate: true })

const ownedWheelsetsOnly = ref(false)
const wheelsets = computed<Wheelset[]>(() => {
  const all = shownWheelsets.value ?? []
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
  shown: shownFrames.value !== undefined,
  ownedOnly: ownedFramesOnly.value,
  ownsCollection: ownedCount.value > 0,
  visible: frames.value.length
}))
const wheelListStatus = computed(() => garageListStatus({
  status: wheelStatus.value,
  shown: shownWheelsets.value !== undefined,
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
  <div class="space-y-6">
    <p class="text-toned">
      Mark which frames and wheels you own, and each frame's upgrade stage
      (0 is stock, 5 fully upgraded). Rankings can then be limited to your
      own equipment, at its real per-stage performance.
    </p>

    <SiteNotice title="Stored on this device only">
      <p>Your garage is saved in this browser's local storage - there's no account system, so it won't follow you to another device or browser.</p>
    </SiteNotice>

    <UTabs
      v-model="activeTab"
      :items="tabItems"
      variant="link"
      color="neutral"
      :ui="{
        list: 'border-b border-accented',
        indicator: 'hidden',
        trigger: 'text-md text-muted data-[state=active]:text-highlighted data-[state=active]:after:content-[\'\'] data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary'
      }"
    >
      <template #content="{ item }">
        <div
          v-if="item.value === 'bikes'"
          class="space-y-4 mt-4"
        >
          <div
            class="flex flex-wrap items-end gap-x-5 gap-y-3"
          >
            <div class="min-w-56 flex-1">
              <label
                :for="bikeSearchId"
                class="mb-1.5 block text-sm font-medium text-highlighted"
              >Search bikes</label>
              <UInput
                :id="bikeSearchId"
                v-model="search"
                icon="i-lucide-search"
                placeholder="e.g. Tarmac, Aethos, Grail..."
              />
            </div>
            <p class="pb-1.5 text-sm text-toned">
              {{ ownedCount }} bike{{ ownedCount === 1 ? "" : "s" }} owned
            </p>
            <div class="flex items-center gap-2 pb-1.5">
              <USwitch
                v-model="ownedFramesOnly"
                aria-label="Only show bikes I own"
              />
              <span class="text-sm text-toned">Only show bikes I own</span>
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
            class="border-t border-default"
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
              variant="outline"
              size="sm"
              @click="ownedFramesOnly = false"
            >
              Show all bikes
            </UButton>
          </div>

          <div
            v-else
            class="border-t border-default"
          >
            <div
              v-for="frame in frames"
              :key="frame.id"
              class="flex flex-wrap items-center justify-between gap-3 border-b border-default py-3"
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
                  <p class="text-sm text-muted">
                    {{ BIKE_CATEGORY_LABELS[frame.category] }}<template v-if="frame.style">
                      · {{ BIKE_STYLE_LABELS[frame.style] }}
                    </template>
                  </p>
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
                  :items="UPGRADE_STAGE_OPTIONS"
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
            class="flex flex-wrap items-end gap-x-5 gap-y-3"
          >
            <div class="min-w-56 flex-1">
              <label
                :for="wheelSearchId"
                class="mb-1.5 block text-sm font-medium text-highlighted"
              >Search wheels</label>
              <UInput
                :id="wheelSearchId"
                v-model="wheelSearch"
                icon="i-lucide-search"
                placeholder="e.g. Zipp, DICUT, Aeolus..."
              />
            </div>
            <p class="pb-1.5 text-sm text-toned">
              {{ ownedWheelCount }} wheelset{{ ownedWheelCount === 1 ? "" : "s" }} owned
            </p>
            <div class="flex items-center gap-2 pb-1.5">
              <USwitch
                v-model="ownedWheelsetsOnly"
                aria-label="Only show wheels I own"
              />
              <span class="text-sm text-toned">Only show wheels I own</span>
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
            class="border-t border-default"
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
              variant="outline"
              size="sm"
              @click="ownedWheelsetsOnly = false"
            >
              Show all wheels
            </UButton>
          </div>

          <div
            v-else
            class="border-t border-default"
          >
            <div
              v-for="wheelset in wheelsets"
              :key="wheelset.key"
              class="flex flex-wrap items-center justify-between gap-3 border-b border-default py-3"
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
                  <p class="text-sm text-muted">
                    {{ WHEEL_CATEGORY_LABELS[wheelset.rear.category] }}
                  </p>
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
