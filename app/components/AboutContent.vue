<script setup lang="ts">
// Shared by `AboutModal.vue` (in-app UX) and `pages/about.vue` (the
// crawlable copy). A modal's content is never in the server-rendered HTML -
// Nuxt UI portals it in only once the dialog opens - so search engines only
// ever see the page version. Keep this component free of modal-specific
// markup so both hosts can style their own heading/container.
</script>

<template>
  <div class="flex flex-col gap-5 text-sm">
    <p>
      Tell it your weight, height and power, and ZwiftBikes ranks every
      frame and wheelset in the game by predicted finish time for the exact
      route you're about to ride - not by a one-size-fits-all "best bike"
      list.
    </p>

    <div class="flex flex-col gap-2">
      <p class="font-medium text-highlighted">Where the numbers come from</p>
      <p>
        Frame and wheel ratings use real ZwiftInsider bot speed-test data
        wherever it exists. Where it doesn't, the app falls back to a clearly
        labelled estimate, so a guess never passes for a fact:
      </p>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="flex items-center gap-1.5">
          <UBadge color="success" variant="subtle" icon="i-lucide-badge-check"
            >verified</UBadge
          >
          <span class="text-muted">real speed-test data</span>
        </span>
        <span class="flex items-center gap-1.5">
          <UBadge color="neutral" variant="subtle" icon="i-lucide-help-circle"
            >estimated</UBadge
          >
          <span class="text-muted">a labelled fallback</span>
        </span>
      </div>
      <p>
        Route surface and elevation come from each route's real GPS trace
        where available, and a heuristic estimate otherwise. The full method
        is written up in
        <ULink
          to="https://github.com/kjellrg/zwift-bikes/blob/main/docs/physics-model.md"
          target="_blank"
          class="underline"
          >How the physics works</ULink
        >.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <p class="font-medium text-highlighted">Built on</p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>
          <ULink
            to="https://www.npmjs.com/package/zwift-data"
            target="_blank"
            class="underline"
            >zwift-data</ULink
          >
          - the catalog of every route, frame, wheel and segment in the game.
        </li>
        <li>
          <ULink to="https://zwiftinsider.com/" target="_blank" class="underline"
            >ZwiftInsider</ULink
          >
          - bot speed-test results for frames and wheels, plus Zwift's
          rolling-resistance values per surface. Their painstaking, publicly
          shared testing is what makes these numbers possible at all.
        </li>
        <li>
          <ULink
            to="https://github.com/andipaetzold/zwiftmap"
            target="_blank"
            class="underline"
            >zwiftmap</ULink
          >
          - hand-mapped surface polygons for each Zwift world, used to work
          out where a route turns to gravel or cobbles.
        </li>
        <li>
          <ULink to="https://www.strava.com/" target="_blank" class="underline"
            >Strava</ULink
          >
          - the real GPS and elevation trace of each route, fetched once when
          the route data is generated. No Strava account or connection is
          needed to use this site.
        </li>
      </ul>
    </div>

    <div class="flex flex-col gap-2">
      <p class="font-medium text-highlighted">Your data</p>
      <p>
        No accounts, no cookies, no analytics, no tracking, no database. Your
        garage and rider profile are saved only in your own browser's local
        storage.
      </p>
      <p>
        Your weight, height and power are sent to the server with each
        recommendation request purely to compute that answer - never stored,
        never shared, never used for anything else.
      </p>
    </div>

    <p class="text-xs text-muted">
      An unofficial fan project, not affiliated with or endorsed by Zwift.
      Zwift is a trademark of Zwift, Inc. The code is MIT-licensed and open
      source on
      <ULink
        to="https://github.com/kjellrg/zwift-bikes"
        target="_blank"
        class="underline"
        >GitHub</ULink
      >.
    </p>
  </div>
</template>
