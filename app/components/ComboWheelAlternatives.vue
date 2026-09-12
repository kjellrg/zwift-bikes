<script setup lang="ts">
import type { ComboScore } from '../../shared/types/catalog'

/**
 * The other wheels that fit a ranked frame, behind a disclosure. The list is
 * fetched on click through the page's `wheelsForFrame` drill-down (see
 * `loadWheelOptions` on `useRecommendRequest`) rather than shipped with every
 * row - the drill-down is ~21 route simulations against the 54 a first page
 * already spends. `combo.wheelOptions` is only the COUNT, which the endpoint
 * has for free, and it decides whether there is a disclosure to offer at all.
 *
 * Gaps in the list are against its own fastest row, not the page's: the
 * question being answered is "which wheels for THIS bike", so the frame's
 * own best is the zero, and the caption says so.
 */
const props = defineProps<{
  combo: ComboScore
  loadWheelOptions?: (frameId: number) => Promise<ComboScore[] | null>
}>()

const { setWheelOwned, isWheelOwned } = useGarage()

const open = ref(false)
const options = ref<ComboScore[]>([])
const status = ref<'idle' | 'loading' | 'error'>('idle')
// Every request carries a version; a response under an older one is dropped.
// A refetch re-ranks these times too, and Vue reuses this component when the
// row keeps its key, so a stale list must never land over a fresh combo.
let version = 0

const canExpand = computed(() => Boolean(props.loadWheelOptions) && !!props.combo.wheelset && (props.combo.wheelOptions ?? 1) > 1)
const fastestSec = computed(() => options.value[0]?.finishTimeSec)
const listId = useId()

async function load() {
  if (!props.loadWheelOptions) return
  const token = ++version
  status.value = 'loading'
  try {
    const result = await props.loadWheelOptions(props.combo.frame.id)
    // `null` is the page saying this answer was computed for a ranking
    // that has since been replaced - or for a ride that no longer ranks
    // anything. A replacement re-renders every row from its own combos, so
    // the watcher below has already cleared this list and, if it is open,
    // asked for the one that belongs to the new ranking.
    if (token !== version || result === null) return
    options.value = result
    status.value = 'idle'
  } catch {
    if (token === version) status.value = 'error'
  }
}

function toggle() {
  open.value = !open.value
  if (open.value && !options.value.length && status.value !== 'loading') load()
}

watch(() => props.combo, () => {
  version++
  options.value = []
  status.value = 'idle'
  if (open.value && canExpand.value) load()
})
onBeforeUnmount(() => version++)

function toggleOwned(option: ComboScore) {
  if (option.wheelset) setWheelOwned(option.wheelset.key, !isWheelOwned(option.wheelset.key))
}
</script>

<template>
  <div
    v-if="canExpand"
    class="border-t border-default pt-3"
  >
    <UButton
      color="neutral"
      variant="ghost"
      size="xs"
      class="px-0"
      :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
      :aria-expanded="open"
      :aria-controls="listId"
      @click="toggle"
    >
      Wheel alternatives
      <UBadge
        color="neutral"
        variant="subtle"
        size="sm"
      >
        {{ combo.wheelOptions }}
      </UBadge>
    </UButton>
    <div
      v-if="open"
      :id="listId"
      class="mt-2 rounded-lg border border-default divide-y divide-default"
      :aria-busy="status === 'loading'"
    >
      <p
        v-if="status === 'loading'"
        class="flex items-center gap-1.5 px-3 py-2 text-sm text-muted"
        role="status"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 animate-spin"
        />Working out the wheels…
      </p>
      <p
        v-else-if="status === 'error'"
        class="px-3 py-2 text-sm text-muted"
        role="alert"
      >
        Couldn't load the wheel options.
        <UButton
          color="neutral"
          variant="link"
          size="xs"
          class="px-0"
          @click="load"
        >
          Try again
        </UButton>
      </p>
      <template v-else>
        <p class="px-3 py-1.5 text-xs text-muted">
          Gaps are against the fastest wheels for this frame, not the fastest setup overall.
        </p>
        <div
          v-for="option in options"
          :key="option.wheelset?.key ?? 'fixed'"
          class="flex items-center gap-2 px-3 py-1.5 text-sm"
        >
          <UTooltip :text="option.wheelset && isWheelOwned(option.wheelset.key) ? 'Remove wheels from garage' : 'Quick-add wheels to garage'">
            <UButton
              :icon="option.wheelset && isWheelOwned(option.wheelset.key) ? 'i-lucide-circle-check' : 'i-lucide-circle-plus'"
              size="xs"
              :color="option.wheelset && isWheelOwned(option.wheelset.key) ? 'success' : 'neutral'"
              variant="ghost"
              class="opacity-50 hover:opacity-100"
              :aria-label="`${option.wheelset && isWheelOwned(option.wheelset.key) ? 'Remove' : 'Quick-add'} ${option.wheelset?.name} ${option.wheelset && isWheelOwned(option.wheelset.key) ? 'from' : 'to'} garage`"
              @click="toggleOwned(option)"
            />
          </UTooltip>
          <span class="min-w-0 flex-1 break-words">{{ option.wheelset?.name }}<span class="ml-1 text-xs text-muted">{{ option.wheelset?.confidence === 'measured' ? 'bot-tested' : 'estimated' }}</span></span>
          <UBadge
            v-if="option.wheelset && combo.wheelset && option.wheelset.key === combo.wheelset.key"
            color="primary"
            variant="subtle"
            size="sm"
          >
            picked
          </UBadge>
          <span
            v-if="option.finishTimeSec !== undefined && fastestSec !== undefined"
            class="shrink-0 tabular-nums"
            :class="option.finishTimeSec - fastestSec > 0 ? 'text-warning' : 'text-primary'"
          >{{ option.finishTimeSec - fastestSec > 0 ? formatDurationGap(option.finishTimeSec - fastestSec) : formatDuration(option.finishTimeSec) }}</span>
          <span
            v-else
            class="shrink-0 text-xs text-muted"
          >no time estimate</span>
        </div>
        <p
          v-if="!options.length"
          class="px-3 py-2 text-sm text-muted"
        >
          No wheel alternatives under the current filters.
        </p>
        <!-- The count on the button is the whole compatible pool's; the list is the best few of it. -->
        <p
          v-else-if="(combo.wheelOptions ?? 0) > options.length"
          class="px-3 py-1.5 text-xs text-muted"
        >
          Fastest {{ options.length }} of {{ combo.wheelOptions }} compatible wheels on this ride.
        </p>
      </template>
    </div>
  </div>
  <p
    v-else-if="combo.frame.hasFixedWheels"
    class="border-t border-default pt-3 text-xs text-muted"
  >
    Fixed disc wheels - no wheel swaps on this frame.
  </p>
</template>
