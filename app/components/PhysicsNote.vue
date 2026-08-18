<script setup lang="ts">
/**
 * The "what are these times, exactly?" alert, shared by the route, segment and
 * event race pages.
 *
 * The endpoints return two versions of the same disclosure: a one-sentence
 * `summary` and the full `note`. The full note runs to four to six sentences
 * once a draft mode is on - the paceline explanation alone is a paragraph -
 * and it sat above the results at full length on every page. A racer opening
 * a race page wants the bike; the model's workings are what they read once,
 * or when a number looks wrong. So the summary leads and the rest goes behind
 * a disclosure that starts closed.
 *
 * `summary` is optional and the note alone renders fine without it, which is
 * what keeps this safe against an endpoint (or a cached response) that
 * predates the field.
 */
const props = defineProps<{
  /** `dynamic` or `legacy`, straight from `physics.mode` - it names the alert. */
  mode: string
  summary?: string
  note: string
}>()

const title = computed(() => props.mode === 'dynamic' ? 'Dynamic physics model active' : 'Legacy finish-time model')
/** Nothing to disclose when there is no summary to lead with, or when it is the whole note. */
const hasDetail = computed(() => Boolean(props.summary) && props.summary !== props.note)
</script>

<template>
  <UAlert
    color="primary"
    variant="subtle"
    icon="i-lucide-atom"
    :title="title"
  >
    <template #description>
      <p>{{ summary ?? note }}</p>
      <UCollapsible
        v-if="hasDetail"
        :ui="{ content: 'mt-2' }"
        class="mt-2"
      >
        <template #default="{ open }">
          <button
            type="button"
            class="inline-flex items-center gap-1 text-sm font-medium underline"
          >
            How the model works
            <UIcon
              :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-4 shrink-0"
            />
          </button>
        </template>
        <template #content>
          <p class="text-sm">
            {{ note }}
          </p>
        </template>
      </UCollapsible>
    </template>
  </UAlert>
</template>
