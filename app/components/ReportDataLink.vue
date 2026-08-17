<script setup lang="ts">
/**
 * The "these numbers look wrong" link that sits under a results list. One
 * shared component so the wording can't drift between the route and segment
 * pages, same reasoning as `EventsDisclaimer`.
 *
 * Deliberately one link per *list* rather than one per `ComboResultCard`: a
 * per-card link would be several hundred of them on a route page, all
 * competing with the quick-add-to-garage controls, for something a rider does
 * once in a blue moon.
 *
 * Keeps a real `href="/report"` so cmd-click and crawlers still reach the
 * page - see the note in `app.vue` about why this is a plain `<a>`.
 */
const props = defineProps<{
  /** What the rider is looking at, used to seed the report's subject. */
  item?: string
}>()

const { openReport } = useOverlays()

function open(event: MouseEvent) {
  openReport(event, { kind: 'data', item: props.item })
}
</script>

<template>
  <p class="text-xs text-muted text-center mt-8">
    Something here look wrong?
    <a
      href="/report"
      class="underline transition-colors hover:text-default"
      @click="open"
    >Report it</a> - corrections with a source get folded back into the data.
  </p>
</template>
