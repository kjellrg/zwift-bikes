<script setup lang="ts">
/**
 * The inline caveat above every results list, driven by the runtime site
 * flags (`notices.recommend` - docs/site-flags.md). The recommend kill
 * switch's softer sibling: during a Zwift rebalance, serving rankings WITH
 * a "being re-verified" warning usually beats serving none, and the caveat
 * belongs next to the numbers it qualifies, not in the site-wide MOTD.
 *
 * Self-contained on purpose - reads and (idempotently) loads the flags
 * itself, so a hosting page adds exactly one line. Not dismissible: a
 * caveat on live numbers stays as long as it applies. Renders nothing
 * until the flags arrive post-mount, the same prerender discipline as the
 * MOTD banner.
 */
const { recommendNotice, load: loadSiteFlags } = useSiteFlags()
onMounted(loadSiteFlags)
</script>

<template>
  <UAlert
    v-if="recommendNotice"
    color="warning"
    variant="subtle"
    icon="i-lucide-flask-conical"
    title="Take today's rankings with a pinch of salt"
    :description="recommendNotice"
    class="mb-6"
  />
</template>
