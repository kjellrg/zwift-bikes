<script setup lang="ts">
import type { TttPlan } from '../composables/useTttPlan'

/**
 * The briefing's TTT line: how many sectors may split or slow the paceline,
 * the first of them, what the model could not analyse, and the way to the
 * full plan. Rendered as further `<li>`s of the briefing list (see
 * `RideBriefing`'s slot), present whenever draft mode is ttt - reading the
 * same `TttPlan` the plan tab renders, so the two cannot disagree.
 */
const props = defineProps<{
  plan: TttPlan
}>()

const { show } = useCourseAnalysisTab()

const summary = computed(() => {
  const { sectors, coverage, hasSetup } = props.plan
  if (coverage.withheld) return coverage.withheld
  if (props.plan.loading) return 'TTT sectors follow the ranking.'
  if (!hasSetup) return 'TTT sectors return with the first match.'
  if (!sectors.length) return 'No sectors flagged by this model.'
  const first = sectors[0]!
  return `${sectors.length} sector${sectors.length === 1 ? '' : 's'} that may split or slow the paceline. `
    + `First: ${first.type === 'climb' ? 'sustained climb' : 'rough surface'} at km ${first.fromKm.toFixed(1)}, ${first.detail}.`
})
</script>

<template>
  <li class="space-y-1">
    <p>
      <UIcon
        name="i-lucide-flag"
        class="mr-1.5 inline-block size-4 align-text-bottom"
      />{{ summary }}
    </p>
    <p
      v-for="caveat in plan.coverage.caveats"
      :key="caveat"
      class="text-xs"
    >
      {{ caveat }}
    </p>
    <UButton
      v-if="!plan.coverage.withheld"
      variant="link"
      size="xs"
      icon="i-lucide-arrow-down"
      class="px-0"
      @click="show('plan')"
    >
      View TTT plan
    </UButton>
  </li>
</template>
