<script setup lang="ts">
import { contactEmailAddress } from '../utils/report'

// Shared by `AboutModal.vue` (in-app UX) and `pages/about.vue` (the
// crawlable copy). A modal's content is never in the server-rendered HTML -
// Nuxt UI portals it in only once the dialog opens - so search engines only
// ever see the page version. Keep this component free of modal-specific
// markup so both hosts can style their own heading/container.

// The report link below is a plain `<a>` with a real `href`, not a `ULink`:
// this component renders inside the About dialog, and a router link there
// navigated to `/report` underneath the still-open dialog. `openReportFromAbout`
// swaps one modal for the other instead. Same modifier-key contract as every
// other overlay link in the app - cmd/ctrl-click still opens the real page.
const { openReportFromAbout } = useOverlays()

// Wrapped in `<ClientOnly>` below, not rendered server-side: `/about` is
// prerendered, so an address in that markup would sit in a static file for
// harvesters. `contactEmailAddress()` assembles it at call time for the same
// reason - see the note in `app/utils/report.ts`.
const contactAddress = contactEmailAddress()
const contactMailto = `mailto:${contactAddress}`
</script>

<template>
  <div class="flex flex-col gap-5 text-sm">
    <p>
      Tell it your weight, height and power, and ZwiftBikes ranks every
      frame and wheelset in the game by predicted finish time for the exact
      route you're about to ride - not by a one-size-fits-all "best bike"
      list.
    </p>

    <p>
      It's a small hobby project from one cyclist and Zwifter, built in
      spare evenings out of pre-race indecision about which frame and
      wheels to bring to the start line - and shared with fellow riders in
      the same generous spirit as the community data it's built on.
    </p>

    <div class="flex flex-col gap-2">
      <h2 class="font-medium text-highlighted">
        Where the numbers come from
      </h2>
      <p>
        Frame and wheel ratings use real ZwiftInsider bot speed-test data
        wherever it exists. Where it doesn't, the app falls back to a clearly
        labelled estimate, so a guess never passes for a fact:
      </p>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="flex items-center gap-1.5">
          <UBadge
            color="success"
            variant="subtle"
            icon="i-lucide-badge-check"
          >verified</UBadge>
          <span class="text-muted">real speed-test data</span>
        </span>
        <span class="flex items-center gap-1.5">
          <UBadge
            color="neutral"
            variant="subtle"
            icon="i-lucide-help-circle"
          >estimated</UBadge>
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
        >How the physics works</ULink>.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <h2 class="font-medium text-highlighted">
        Built on
      </h2>
      <p>
        Nothing here would exist without work the community shares freely:
      </p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>
          <ULink
            to="https://zwiftinsider.com/"
            target="_blank"
            class="underline"
          >ZwiftInsider</ULink>
          - bot speed-test results for frames and wheels, plus Zwift's
          rolling-resistance values per surface. Their painstaking, publicly
          shared testing is what makes these numbers possible at all.
        </li>
        <li>
          <ULink
            to="https://www.npmjs.com/package/zwift-data"
            target="_blank"
            class="underline"
          >zwift-data</ULink>
          - the catalog of every route, frame, wheel and segment in the game.
        </li>
        <li>
          <ULink
            to="https://github.com/andipaetzold/zwiftmap"
            target="_blank"
            class="underline"
          >zwiftmap</ULink>
          - hand-mapped surface polygons for each Zwift world, used to work
          out where a route turns to gravel or cobbles.
        </li>
        <li>
          <ULink
            to="https://www.strava.com/"
            target="_blank"
            class="underline"
          >Strava</ULink>
          - the real GPS and elevation trace of each route, fetched once when
          the route data is generated. No Strava account or connection is
          needed to use this site.
        </li>
        <li>
          <ULink
            to="https://www.wtrl.racing/"
            target="_blank"
            class="underline"
          >WTRL</ULink>
          - the Zwift Racing League schedules behind the race calendar,
          typed in by hand from their published rounds together with Zwift's
          own event announcements. Every race links back to where its
          details came from.
        </li>
      </ul>
    </div>

    <div class="flex flex-col gap-2">
      <h2 class="font-medium text-highlighted">
        Your data
      </h2>
      <p>
        No accounts, no analytics, no tracking, no database, and no cookies
        of our own. Your garage and rider profile are saved only in your own
        browser's local storage.
      </p>
      <p>
        Your weight, height and power are sent to the server with each
        recommendation request purely to compute that answer - never logged,
        never shared, never used for anything else. Computed answers may be
        cached briefly at the network edge to keep the site fast; the cache
        holds the question and its answer, never who asked.
      </p>
      <p>
        One cookie can still appear: <code>cf_clearance</code>, set by
        Cloudflare, the network this site runs on. When Cloudflare's
        protection asks your browser to prove it isn't a bot, this cookie
        remembers that you passed, so you aren't re-checked on every click.
        It exists purely to keep the site online under attack - it doesn't
        identify you, isn't used for tracking, can't be turned off, and
        expires on its own.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <h2 class="font-medium text-highlighted">
        Reporting an issue
      </h2>
      <p>
        The
        <a
          href="/report"
          class="underline"
          @click="openReportFromAbout"
        >Report an issue</a>
        form fills in the report for you, then opens it as either a GitHub
        issue or an email - you read it over and send it yourself. Your rider
        profile is left out unless you tick the box to include it.
      </p>
      <p>
        GitHub is the public site where this project's code and bug list live,
        so anything posted there can be read by anyone. Email goes privately
        to the people who maintain the site. If we turn your emailed report
        into a GitHub issue, your email address never goes in it. Your name
        only shows up there if you ask to be credited.
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <h2 class="font-medium text-highlighted">
        Getting in touch
      </h2>
      <p>
        A question, a suggestion, or anything that isn't a bug?
        <ClientOnly>
          Write to
          <a
            :href="contactMailto"
            class="underline"
          >{{ contactAddress }}</a>.
          <template #fallback>
            The report form above reaches us too, whatever you want to say.
          </template>
        </ClientOnly>
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
      >GitHub</ULink>.
    </p>
  </div>
</template>
