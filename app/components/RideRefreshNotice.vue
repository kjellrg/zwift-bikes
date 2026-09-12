<script setup lang="ts">
/**
 * What a rider is owed when the ranking could not be brought up to date: a
 * notice that stays beside the results saying so, and a way to ask again.
 *
 * A failed refresh is quiet without it. The rows, the recommendation and
 * every explanation stay exactly as they were - which is the point, they
 * still belong together - so nothing on the page would otherwise show that
 * they predate the controls above them. The toast that speaks at the moment
 * of failure (`useRefetchNotice`) is gone seconds later, and the rider who
 * looked away has no way back.
 *
 * It is gone while the next attempt runs - the updating indicator says
 * that better than a notice with a spinner in it - and back again if that
 * attempt fails too.
 *
 * It says the results are the previous ones rather than naming what failed:
 * the rider's question is whether to trust the numbers in front of them,
 * and the kind of failure - a throttle, a paused service, a dropped
 * connection - is what the toast at the time was for.
 */
const props = defineProps<{
  /** The last required refresh failed, so what is displayed predates the rider's choices. */
  failed: boolean
  /** Whether a ranking is on screen at all: a first load that failed has nothing to keep. */
  hasResults: boolean
}>()

defineEmits<{ retry: [] }>()

const description = computed(() => props.hasResults
  ? 'The ranking below is the one from before the change, so it does not answer your latest choices.'
  : 'Nothing has been ranked yet for this ride.')
</script>

<template>
  <!-- `alert` rather than the polite region the acceptance announcement
       uses: this appears in place of the update the rider asked for, and
       the ranking underneath it is now telling them something untrue. -->
  <UAlert
    v-if="failed"
    id="ride-refresh-notice"
    color="warning"
    variant="subtle"
    icon="i-lucide-refresh-cw-off"
    role="alert"
    :title="hasResults ? 'Couldn\'t update the results' : 'Couldn\'t load the results'"
    :description="description"
  >
    <template #actions>
      <UButton
        color="warning"
        variant="solid"
        size="xs"
        icon="i-lucide-rotate-cw"
        @click="$emit('retry')"
      >
        Try again
      </UButton>
    </template>
  </UAlert>
</template>
