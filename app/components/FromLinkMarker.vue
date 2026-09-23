<script setup lang="ts">
/**
 * The "from link" pill beside a value a link supplied for the visit (see
 * **Shared view** in `CONTEXT.md`), and the way out of it: pressing it asks
 * the owner to restore the rider's saved value. One component because the
 * pill sits beside every control that shows such a value - the rider strip,
 * the equipment filters' summary and the draft select in the slider box -
 * and its wording and accessible name must not drift between them. Storing
 * nothing is the restore function's promise, not this pill's.
 */
defineProps<{
  /** The accessible name and tooltip - "Restore my saved draft mode" / "Restore my saved category". */
  restoreLabel: string
}>()
defineEmits<{ restore: [] }>()
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-0.5 rounded-full border border-accented px-2 text-xs text-toned hover:border-ink hover:text-highlighted"
    :aria-label="restoreLabel"
    :title="restoreLabel"
    @click="$emit('restore')"
  >
    from link<UIcon
      name="i-lucide-x"
      class="size-3"
    />
  </button>
</template>
