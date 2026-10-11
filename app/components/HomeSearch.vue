<script setup lang="ts">
import type { SegmentSummary } from '../../shared/types/catalog'
import type { RouteCardData } from '#shared/utils/routeCards'
import { nearMatches, rankedMatches } from '../utils/homeSearch'

/**
 * The homepage's hero search as a combobox (#331): as the rider types, a
 * list opens under it with the routes and the climbs and sprints the term
 * names, and choosing one opens its page. The list is the answer the rider
 * can see - the route grid it also filters starts a screen or more further
 * down.
 *
 * A Discovery page shows identity and the numbers a rider chooses by, so a
 * route option is its Silhouette, name, world, distance and climbing, and a
 * segment option its Silhouette, name, kind and world - never a time or a
 * setup, which a ranking would answer.
 *
 * The ARIA combobox pattern with list autocomplete: focus stays in the
 * input, the arrow keys move `aria-activedescendant` through the options,
 * Enter opens the highlighted one and Esc closes the list and keeps the
 * term. Enter with nothing highlighted takes the rider to the grid instead.
 * The segments come from the page, which fetches them the first time the
 * search is used (`use`), so the homepage's own load carries none.
 */
const props = defineProps<{
  cards: readonly RouteCardData[]
  /** Undefined until the page has fetched them. */
  segments: readonly SegmentSummary[] | undefined
}>()

const term = defineModel<string>({ required: true })

const emit = defineEmits<{
  /** The search was focused: the page fetches the segments, once. */
  use: []
  /** An option was chosen: the page opens it. */
  open: [to: string]
  /** Enter with no option highlighted: the page shows the grid. */
  submit: []
  reset: []
}>()

/** How many of each kind the list offers: enough to see, few enough to fit over a phone's keyboard. */
const ROUTE_LIMIT = 6
const SEGMENT_LIMIT = 4
const NEAR_LIMIT = 3

const id = useId()
const listboxId = `${id}-listbox`
const statusId = `${id}-status`

const open = ref(false)
const active = ref(-1)
const root = useTemplateRef<HTMLElement>('root')

const routeOptions = computed(() => rankedMatches(props.cards, term.value, ROUTE_LIMIT))
const segmentOptions = computed(() => rankedMatches(props.segments ?? [], term.value, SEGMENT_LIMIT))
const options = computed(() => [
  ...routeOptions.value.map(route => ({ key: `r-${route.slug}`, to: `/routes/${route.slug}` })),
  ...segmentOptions.value.map(segment => ({ key: `s-${segment.slug}`, to: `/segments/${segment.slug}` }))
])
const optionId = (key: string) => `${id}-${key}`
const near = computed(() => options.value.length ? [] : nearMatches(props.cards, term.value, NEAR_LIMIT))
const hasTerm = computed(() => term.value.trim() !== '')
const expanded = computed(() => open.value && hasTerm.value)

const segmentKind = (segment: SegmentSummary) => segment.type === 'sprint' ? 'Sprint' : 'Climb'

// What a screen reader hears as the list changes. Kept in the DOM even while
// the list is shut - a live region that appears with its text is announced
// by nothing.
const status = computed(() => {
  if (!expanded.value) return ''
  if (!options.value.length) return `No route${props.segments ? ' or segment' : ''} named “${term.value.trim()}”.`
  const parts = [`${routeOptions.value.length} route${routeOptions.value.length === 1 ? '' : 's'}`]
  if (props.segments) parts.push(`${segmentOptions.value.length} climb${segmentOptions.value.length === 1 ? '' : 's'} and sprints`)
  return `${parts.join(', ')}. Arrow down to choose.`
})

function onInput() {
  open.value = true
  active.value = -1
  revealOnPhone()
}

/**
 * On a phone the keyboard takes half the screen, and the hero puts the
 * search a third of the way down it - lift the input to just under the
 * header so the list's first results open above the keyboard.
 */
function revealOnPhone() {
  if (window.matchMedia('(max-width: 639px)').matches) root.value?.scrollIntoView({ block: 'start' })
}

function move(step: number) {
  const count = options.value.length
  if (!count) return
  active.value = active.value < 0
    ? (step > 0 ? 0 : count - 1)
    : (active.value + step + count) % count
  document.getElementById(optionId(options.value[active.value]!.key))?.scrollIntoView({ block: 'nearest' })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!hasTerm.value) return
    event.preventDefault()
    if (!open.value) {
      open.value = true
      return
    }
    move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const chosen = expanded.value ? options.value[active.value] : undefined
    open.value = false
    if (chosen) emit('open', chosen.to)
    else if (hasTerm.value) emit('submit')
  } else if (event.key === 'Escape' && expanded.value) {
    event.preventDefault()
    open.value = false
  }
}

// The list shuts when focus leaves the search for anything outside it; a
// Tab onto the empty state's own links and Reset keeps it open.
function onFocusout(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) open.value = false
}

function choose(to: string) {
  open.value = false
  emit('open', to)
}

function reset() {
  open.value = false
  emit('reset')
}

watch(options, () => {
  active.value = -1
})
</script>

<template>
  <div
    ref="root"
    class="relative w-full max-w-xl scroll-mt-[calc(var(--ui-header-height)+0.75rem)]"
    @focusout="onFocusout"
  >
    <UInput
      v-model="term"
      icon="i-lucide-search"
      size="xl"
      role="combobox"
      aria-label="Search routes"
      aria-autocomplete="list"
      :aria-expanded="expanded && options.length > 0"
      :aria-controls="listboxId"
      :aria-activedescendant="expanded && active >= 0 ? optionId(options[active]!.key) : undefined"
      :aria-describedby="statusId"
      autocomplete="off"
      placeholder="Route, climb or world, e.g. Alpe du Zwift"
      class="w-full"
      @input="onInput"
      @keydown="onKeydown"
      @focus="emit('use')"
    />
    <p
      :id="statusId"
      class="sr-only"
      aria-live="polite"
    >
      {{ status }}
    </p>
    <div
      v-show="expanded"
      class="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[min(28rem,60vh)] overflow-y-auto rounded-lg border border-default bg-elevated p-1.5 shadow-lg"
    >
      <!-- Every option keeps the input's focus on press (`mousedown.prevent`),
           so a click opens the ride rather than blurring the search and
           shutting the list under the pointer first. -->
      <!-- The listbox stays in the DOM, empty, when nothing matched, so the
           input's `aria-controls` always names an element; the combobox
           then reports itself collapsed and the empty state below is read
           through the live status instead. -->
      <ul
        :id="listboxId"
        role="listbox"
        aria-label="Search results"
      >
        <li
          v-if="routeOptions.length"
          role="presentation"
        >
          <p
            :id="`${id}-routes`"
            class="px-2.5 pt-1.5 pb-1 text-xs text-muted"
          >
            Routes
          </p>
          <ul
            role="group"
            :aria-labelledby="`${id}-routes`"
          >
            <li
              v-for="route in routeOptions"
              :id="optionId(`r-${route.slug}`)"
              :key="route.slug"
              role="option"
              :aria-selected="options[active]?.key === `r-${route.slug}`"
              class="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2"
              :class="options[active]?.key === `r-${route.slug}` ? 'bg-accented' : 'hover:bg-accented/60'"
              @mousedown.prevent
              @click="choose(`/routes/${route.slug}`)"
            >
              <RouteSilhouette
                :shape="route.shape"
                class="h-7 w-14 shrink-0"
              />
              <span class="min-w-0">
                <span class="block truncate font-medium text-highlighted">{{ route.name }}</span>
                <span class="block text-xs text-muted">{{ route.worldName }} · {{ route.distance.toFixed(1) }} km · {{ Math.round(route.elevation) }} m</span>
              </span>
            </li>
          </ul>
        </li>
        <li
          v-if="segmentOptions.length"
          role="presentation"
        >
          <p
            :id="`${id}-segments`"
            class="px-2.5 pt-2.5 pb-1 text-xs text-muted"
          >
            Climbs and sprints
          </p>
          <ul
            role="group"
            :aria-labelledby="`${id}-segments`"
          >
            <li
              v-for="segment in segmentOptions"
              :id="optionId(`s-${segment.slug}`)"
              :key="segment.slug"
              role="option"
              :aria-selected="options[active]?.key === `s-${segment.slug}`"
              class="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2"
              :class="options[active]?.key === `s-${segment.slug}` ? 'bg-accented' : 'hover:bg-accented/60'"
              @mousedown.prevent
              @click="choose(`/segments/${segment.slug}`)"
            >
              <RouteSilhouette
                :shape="segment.shape"
                class="h-7 w-14 shrink-0"
              />
              <span class="min-w-0">
                <span class="block truncate font-medium text-highlighted">{{ segment.name }}</span>
                <span class="block text-xs text-muted">{{ segmentKind(segment) }} · {{ segment.worldName }}</span>
              </span>
            </li>
          </ul>
        </li>
      </ul>
      <SearchEmptyState
        v-if="!options.length"
        :term="term"
        :near="near"
        :segments-checked="!!segments"
        class="px-2.5 py-2"
        @mousedown.prevent
        @reset="reset"
      />
    </div>
  </div>
</template>
