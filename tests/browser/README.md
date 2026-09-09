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
response, the results region leaving `aria-busy`), never sleeps.

Failure traces and screenshots land in `test-results/`, which is gitignored:
screenshots are local evidence, not fixtures, and none are committed.
