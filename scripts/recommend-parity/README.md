# Recommend endpoint parity check

Proves that a change to `server/utils/recommendPipeline.ts` or either recommend
endpoint changed **nothing** - or shows exactly what it changed. It runs the
real handlers, not a model of them, on two checkouts and diffs every response.
**Nothing in `app/`, `server/`, or the Nuxt build runs this**; it is the
endpoint-level counterpart of the `physics-regression-check` agent, which
covers `shared/utils` one layer down.

Written for #77, where the two endpoints' duplicated orchestration was pulled
into one module and the only acceptable result was zero diffs. The ordering in
that pipeline is subtle (search before capping, the reachable window re-ordered
by simulated time before pagination, the wheel pick confirmed after), and this
is the check that catches a step moving.

```sh
npm run parity:recommend                 # this tree vs. the merge-base with main
npm run parity:recommend -- d5481d0      # this tree vs. a specific commit
```

A few minutes per side, run one side after the other. Do not run it while a
build or dev server is up - the usual dev box does not have the memory.

## What it compares

`run.mjs` writes one sorted-key JSON file per case: the response (or the
error's status and message) plus the request's timing meta, which carries the
`sims` and `combos` counts. So a change that keeps every number but does the
work differently - simulating more, or fewer, combos - is a diff too.

Rides are resolved from the live catalog at run time and printed:

- routes: Tempus Fugit (flat), Road to Sky (alpine), Cobbled Climbs, Jungle
  Circuit (gravel), Big Foot Hills (long mixed), plus one point-to-point route
  and one route for each of the two geometry fallbacks (`aggregate-compatibility`,
  `known-climbs-compatibility`);
- segments: a sprint at the default sprint power, Alpe du Zwift, a climb with
  no measured profile, and an off-road segment.

Per ride: no profile; the site's default query at offset 0 and 9; legacy and
compare physics; TTT draft in dynamic and legacy mode; race draft; search;
every category with Halo bikes; TT only without them; unverified equipment
included; upgrade levels 0 and 5; an over-limit `limit` (400); 150 W; and for
routes `excludeTT` and two laps. Then, seeded from that ride's own first page,
a `wheelsForFrame` drill-down (dynamic and legacy) and an `ownedOnly` garage.
Plus unknown slugs (404), a rider who cannot hold the grade (422), and four MCP
tool calls with `$fetch` dispatched at the same handlers.

## How it runs a handler without a server

Modules load through jiti, the TypeScript loader Nuxt itself depends on, so
the handlers and `server/utils/timing.ts` share one module instance and the
script can read the timing meta a handler wrote. Nitro's auto-imported globals
are stubbed to the minimum: `getRouterParam` returns the case's slug,
`useRuntimeConfig` has no build SHA so the edge-cache wrapper falls through,
and `$fetch` (for the MCP cases) dispatches straight at the handlers. Nothing
in the ranking path is stubbed.

## Reading a non-zero result

`compare.mjs` prints each differing case with the first line that differs and
keeps both output directories. `diff` the two files it names: a diff confined
to `timingMeta.sims` means the work changed but not the answer; a diff in
`response.combos` means the ranking or a time moved, and that needs explaining
in the PR whether or not it was intended.
