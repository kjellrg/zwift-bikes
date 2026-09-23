<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'

/**
 * The Wheel alternatives in a Ranking row's disclosure: the other wheels
 * that fit this frame on the Ride, fastest first. Mounted when the row
 * opens, and fetched then through the page's `wheelsForFrame` drill-down
 * (see `loadWheelOptions` on `useRecommendRequest`) rather than shipped with
 * every row - the drill-down is ~21 route simulations against the 54 a
 * first page already spends. `combo.wheelOptions` is only the COUNT, which
 * the endpoint has for free.
 *
 * Gaps are against the frame's own fastest wheels, not the page's: the
 * question answered here is "which wheels for THIS bike", so its own best is
 * the zero, and the caption says so. Gaps are plain ink - a gap is data, not
 * a warning.
 */
const props = defineProps<{
  combo: ComboScore
  loadWheelOptions?: (frameId: number) => Promise<ComboScore[] | null>
}>()

/** How many of the alternatives a row lists - the fastest few of the compatible pool. */
const SHOWN = 5

const { setWheelOwned, isWheelOwned } = useGarage()

const options = ref<ComboScore[]>([])
const status = ref<'loading' | 'loaded' | 'error'>('loading')
// Every request carries a version; a response under an older one is dropped.
// A refetch re-ranks these times too, and Vue reuses this component when the
// row keeps its key, so a stale list must never land over a fresh combo.
let version = 0

const fastestSec = computed(() => options.value[0]?.finishTimeSec)
const shown = computed(() => options.value.slice(0, SHOWN))

async function load() {
  if (!props.loadWheelOptions) return
  const token = ++version
  status.value = 'loading'
  try {
    const result = await props.loadWheelOptions(props.combo.frame.id)
    // `null` is the page saying this answer was computed for a ranking
    // that has since been replaced - or for a ride that no longer ranks
    // anything. A replacement re-renders every row from its own combos, so
    // the watcher below has already asked for the one that belongs to it.
    if (token !== version || result === null) return
    options.value = result
    status.value = 'loaded'
  } catch {
    if (token === version) status.value = 'error'
  }
}

onMounted(load)
watch(() => props.combo, () => {
  options.value = []
  load()
})
onBeforeUnmount(() => version++)

function toggleOwned(option: ComboScore) {
  if (option.wheelset) setWheelOwned(option.wheelset.key, !isWheelOwned(option.wheelset.key))
}
</script>

<template>
  <div
    class="min-w-0"
    :aria-busy="status === 'loading'"
  >
    <p
      v-if="status === 'loading'"
      class="flex items-center gap-1.5 text-sm text-muted"
      role="status"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-4 animate-spin"
      />Working out the wheels…
    </p>
    <p
      v-else-if="status === 'error'"
      class="text-sm text-muted"
      role="alert"
    >
      Couldn't load the wheel options.
      <button
        type="button"
        class="text-primary underline"
        @click="load"
      >
        Try again
      </button>
    </p>
    <template v-else>
      <p class="text-xs text-muted">
        Gaps are against the fastest wheels for this frame, not the fastest setup overall.
      </p>
      <ul
        v-if="shown.length"
        class="mt-1 text-sm"
        :aria-label="`Wheel alternatives for ${combo.frame.name}`"
      >
        <li
          v-for="option in shown"
          :key="option.wheelset?.key ?? 'fixed'"
          class="flex items-center gap-2 border-b border-dashed border-default py-1.5 last:border-b-0"
        >
          <button
            type="button"
            class="shrink-0 text-muted hover:text-highlighted"
            :class="option.wheelset && isWheelOwned(option.wheelset.key) ? 'text-success' : ''"
            :aria-label="`${option.wheelset && isWheelOwned(option.wheelset.key) ? 'Remove' : 'Quick-add'} ${option.wheelset?.name} ${option.wheelset && isWheelOwned(option.wheelset.key) ? 'from' : 'to'} garage`"
            :title="option.wheelset && isWheelOwned(option.wheelset.key) ? 'In your garage' : 'Add to your garage'"
            @click="toggleOwned(option)"
          >
            <UIcon
              :name="option.wheelset && isWheelOwned(option.wheelset.key) ? 'i-lucide-circle-check' : 'i-lucide-circle-plus'"
              class="size-4"
            />
          </button>
          <span class="min-w-0 flex-1 break-words">
            {{ option.wheelset?.name }}
            <span
              v-if="option.wheelset && combo.wheelset && option.wheelset.key === combo.wheelset.key"
              class="text-xs text-muted"
            >· this row</span>
            <span
              v-if="option.wheelset?.confidence !== 'measured'"
              class="text-xs text-warning"
            >· estimate</span>
          </span>
          <span
            v-if="option.finishTimeSec !== undefined && fastestSec !== undefined"
            class="shrink-0 text-toned"
          >{{ option.finishTimeSec - fastestSec > 0 ? formatDurationGap(option.finishTimeSec - fastestSec) : 'fastest' }}</span>
          <span
            v-else
            class="shrink-0 text-xs text-muted"
          >no time estimate</span>
        </li>
      </ul>
      <p
        v-else
        class="mt-1 text-sm text-muted"
      >
        No wheel alternatives under the current filters.
      </p>
      <!-- The count is the whole compatible pool's; the list is the best few of it. -->
      <p
        v-if="(combo.wheelOptions ?? 0) > shown.length"
        class="mt-1.5 text-xs text-muted"
      >
        Fastest {{ shown.length }} of {{ combo.wheelOptions }} compatible wheels on this ride.
      </p>
    </template>
  </div>
</template>
