<script setup lang="ts">
import type { SegmentSummary } from '../../shared/types/catalog'
import type { RouteCardData } from '#shared/utils/routeCards'
import type { Silhouette } from '#shared/utils/silhouette'
import { matchesSearch, NEAR_MATCH_LIMIT, nearMatches, noMatchHeadline, rankedMatches } from '../utils/homeSearch'

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
 * The segments come from the page, which fetches them when the search is
 * first focused, so the homepage's own load carries none.
 */
const props = defineProps<{
  cards: readonly RouteCardData[]
  /** Undefined until the page has fetched them. */
  segments: readonly SegmentSummary[] | undefined
}>()

const term = defineModel<string>({ required: true })

const emit = defineEmits<{
  /** The search took focus: the page fetches the segments, the first time. */
  focus: []
  /** An option was chosen: the page opens it. */
  open: [to: string]
  /** Enter with no option highlighted: the page shows the grid. */
  submit: []
  reset: []
}>()

/** How many of each kind the list offers: enough to see, few enough to fit over a phone's keyboard. */
const ROUTE_LIMIT = 6
const SEGMENT_LIMIT = 4

/** One row of the list, whichever kind of Ride it opens. */
interface SearchOption {
  id: string
  to: string
  name: string
  /** The line under the name: identity and the numbers a rider chooses by. */
  detail: string
  shape: Silhouette | undefined
}

const id = useId()
const listboxId = `${id}-listbox`
const statusId = `${id}-status`

const open = ref(false)
const active = ref(-1)
const root = useTemplateRef<HTMLElement>('root')

const groups = computed(() => [
  {
    id: `${id}-routes`,
    label: 'Routes',
    options: rankedMatches(props.cards, term.value, ROUTE_LIMIT).map((route): SearchOption => ({
      id: `${id}-r-${route.slug}`,
      to: `/routes/${route.slug}`,
      name: route.name,
      detail: `${route.worldName} · ${route.distance.toFixed(1)} km · ${Math.round(route.elevation)} m`,
      shape: route.shape
    }))
  },
  {
    id: `${id}-segments`,
    label: 'Climbs and sprints',
    options: rankedMatches(props.segments ?? [], term.value, SEGMENT_LIMIT).map((segment): SearchOption => ({
      id: `${id}-s-${segment.slug}`,
      to: `/segments/${segment.slug}`,
      name: segment.name,
      detail: `${segment.type === 'sprint' ? 'Sprint' : 'Climb'} · ${segment.worldName}`,
      shape: segment.shape
    }))
  }
].filter(group => group.options.length))
const options = computed(() => groups.value.flatMap(group => group.options))
const activeId = computed(() => options.value[active.value]?.id)

const near = computed(() => options.value.length ? [] : nearMatches(props.cards, term.value, NEAR_MATCH_LIMIT))
const hasTerm = computed(() => term.value.trim() !== '')
const expanded = computed(() => open.value && hasTerm.value)

// What a screen reader hears as the list changes: every match, not just the
// few the list shows, and on no match the empty state's own words. Kept in
// the DOM while the list is shut - a live region that appears with its text
// is announced by nothing.
const status = computed(() => {
  if (!expanded.value) return ''
  if (!options.value.length) {
    const headline = noMatchHeadline(term.value, !!props.segments)
    return near.value.length ? `${headline} Did you mean ${near.value.map(route => route.name).join(' or ')}?` : headline
  }
  const routes = props.cards.filter(card => matchesSearch(card, term.value)).length
  const parts = [`${routes} route${routes === 1 ? '' : 's'}`]
  if (props.segments) {
    const segments = props.segments.filter(segment => matchesSearch(segment, term.value)).length
    parts.push(`${segments} ${segments === 1 ? 'climb or sprint' : 'climbs and sprints'}`)
  }
  return `${parts.join(' and ')} match. Arrow down to choose.`
})

function onInput() {
  if (!open.value) revealOnPhone()
  open.value = true
  active.value = -1
}

/**
 * On a phone the keyboard takes half the screen, and the hero puts the
 * search a third of the way down it - as the list opens, lift the input to
 * just under the header so the first results sit above the keyboard.
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
  if (activeId.value) document.getElementById(activeId.value)?.scrollIntoView({ block: 'nearest' })
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
      :aria-activedescendant="expanded ? activeId : undefined"
      :aria-describedby="statusId"
      autocomplete="off"
      placeholder="Route, climb or world, e.g. Alpe du Zwift"
      class="w-full"
      @input="onInput"
      @keydown="onKeydown"
      @focus="emit('focus')"
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
      <!-- The listbox stays in the DOM, empty, when nothing matched, so the
           input's `aria-controls` always names an element; the combobox
           then reports itself collapsed and the live status reads the empty
           state out instead. Every option keeps the input's focus on press
           (`mousedown.prevent`), so a click opens the ride rather than
           blurring the search and shutting the list under the pointer. -->
      <ul
        :id="listboxId"
        role="listbox"
        aria-label="Search results"
      >
        <li
          v-for="(group, index) in groups"
          :key="group.id"
          role="presentation"
        >
          <p
            :id="group.id"
            class="px-2.5 pb-1 text-xs text-muted"
            :class="index ? 'pt-2.5' : 'pt-1.5'"
          >
            {{ group.label }}
          </p>
          <ul
            role="group"
            :aria-labelledby="group.id"
          >
            <li
              v-for="option in group.options"
              :id="option.id"
              :key="option.id"
              role="option"
              :aria-selected="option.id === activeId"
              class="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2"
              :class="option.id === activeId ? 'bg-accented' : 'hover:bg-accented/60'"
              @mousedown.prevent
              @click="choose(option.to)"
            >
              <RouteSilhouette
                :shape="option.shape"
                class="h-7 w-14 shrink-0"
              />
              <span class="min-w-0">
                <span class="block truncate font-medium text-highlighted">{{ option.name }}</span>
                <span class="block text-xs text-muted">{{ option.detail }}</span>
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
