# Browser journeys

End-to-end checks through the real app with [Playwright](https://playwright.dev/):
a spec drives the dev server in Chromium and asserts what a rider or a crawler
sees - layout order, real finish times against the API response, server-rendered
HTML - never component internals.

```sh
npm run test:browser              # starts `nuxt dev` on port 3010, or reuses one already there
npm run test:browser -- --project=desktop
npm run test:browser -- --ui      # Playwright's UI mode, needs a display
```

Chromium is installed once with `npx playwright install chromium`. The suite is
not part of `npm test` and does not run in CI yet: a cold dev server compiles a
route page in ~20 s and each recommend request takes seconds, so the timeouts
in `playwright.config.ts` are generous and the suite runs one worker. On a
small machine run it on its own, not alongside `npm run typecheck` or
`npm run build`.

Every test gets a fresh browser context, so localStorage starts empty - the
rider is the composable default (75 kg, 175 cm, 225 W, solo) unless a test
seeds storage itself. Waits are for real signals (hydration, a recommend
response, the results region leaving `aria-busy`), never sleeps: every spec
imports them from `support.ts`, which owns the waits and the one helper that
seeds a rider profile before a page reads it - locators stay in the spec that
uses them. A response is stubbed only where the failure itself is what is
under test - one recommend journey, the aborted refetch in each of
`route-discovery.spec.ts` and `segment-discovery.spec.ts`, and the failed
season calendar in `event-discovery.spec.ts` (which closes two doors: the API
and the route's extracted payload, which Nuxt would otherwise answer that
navigation from); a stub is never used to make a real journey faster. The one other stub is `site-flags.spec.ts`, which answers
`/api/site-flags` by hand: the flags live in Workers KV and the dev server
only ever serves the defaults, so a hidden section or a message of the day
cannot be seen any other way. `visit` waits for a ranking page's results;
`visitPage` is for the pages without one (the discovery pages, events,
profile).

The events pages resolve next/upcoming/past post-mount from the browser's own
clock, because they are prerendered and a build-time answer would ship frozen.
So `event-discovery.spec.ts` pins the clock with `page.clock.setFixedTime`
before navigating, and asserts against the real curated calendars.
`setFixedTime` rather than `clock.install`: only `Date` has to be
deterministic here, and freezing the timers with it would leave the app's own
scheduling waiting for a tick the test never grants.

Failure traces and screenshots land in `test-results/`, which is gitignored:
screenshots are local evidence, not fixtures, and none are committed.

## Long runs on a memory-constrained machine

`nuxt dev` gets slower the longer a run goes on, and it is the dev server that
degrades, not the tests. Measured on the dev box: mobile journeys that finish in
5.9 s and 7.9 s early in a run take 34.4 s and 20.4 s late in a long one, and a
journey that passes in 8.8 s on its own can sit past the 240 s test timeout in a
full two-project run. The failure always looks the same - `page.waitForResponse`
or `ready()` timing out, never an assertion - and the same test passes on its own
seconds later, so a single timeout of that shape is not evidence of a regression.

What keeps a long run honest:

- **Start the dev server by hand and warm the pages first.** `curl` each route,
  segment and discovery page the specs visit before starting Playwright, so the
  first spec does not pay a cold compile inside a test timeout.
- **Run one project at a time** (`--project=desktop`, then `--project=mobile`),
  restarting `nuxt dev` between them. Two projects back to back is where the
  degradation shows, and a restart costs less than a 240 s timeout.
- **Split a full run by spec file** when even one project is shaky, and never run
  the suite next to `npm run typecheck`, `npm run build` or a second dev server.
- **Confirm before believing a failure.** Re-run the failing test alone, then its
  whole file, then its project. A real regression fails at every level; a harness
  timeout only fails in the long run. Read the timings of the tests around it -
  inflation across the run is the tell.
- **Prefer waiting on real signals.** Every wait in `support.ts` is for hydration,
  a response or `aria-busy`; a sleep tuned to a fast run is what turns
  degradation into a false failure.
