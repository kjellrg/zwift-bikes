# Observability: where a request's time goes

Every request the server handles emits its own timing, two ways:

- a **`Server-Timing` response header**, visible per response in any browser's
  network panel (Chrome/Edge render it in the Timing tab as named bars);
- one **JSON line per request via `console.log`**, which Workers Logs ingests
  as a structured event - every field indexed and filterable in the
  dashboard, no parsing step in between.

Both come from the same measurements: `server/plugins/timing.ts` starts a
timer on every request, the handlers call `markPhase()` at the seams worth
separating, and `server/utils/timing.ts` holds the plumbing.

## The clock is frozen while computing - and how this survives that

As a Spectre mitigation, a deployed Worker's `performance.now()` and
`Date.now()` **only advance when the isolate returns to the event loop for
I/O**. Two reads separated by pure computation return the same value, and the
recommend handlers are pure CPU end to end - measured naively, every phase
here would read 0ms in production while working fine in local dev (where
clocks advance normally).

`advanceClock()` in `server/utils/timing.ts` is the workaround: awaiting a
zero-delay timer returns to the event loop, after which the clock reflects
real time again. `markPhase()` awaits it before every read, which is why it
is async and why every call site says `await markPhase(...)`. The cost is one
macrotask hop per phase - microseconds against phases measured in tens to
thousands of milliseconds.

If phase durations ever read as implausible zeros on a deployed Worker while
`wrangler dev` shows real numbers, this mechanism is what regressed.

## What a line looks like

```json
{
  "evt": "request",
  "reqId": "4a8db278a5f74946b7a98ee6cd0ee51a",
  "host": "zwiftbikes.com",
  "path": "/api/recommend/london-the-prl-full",
  "status": 200,
  "totalMs": 3074.7,
  "cold": true,
  "phases": { "pool": 505.5, "rank": 13.5, "geometry": 1.1, "estimate": 59.6,
              "filter": 3.5, "simulate": 2485.8, "page": 0.4, "extras": 0 },
  "route": "london-the-prl-full", "distanceKm": 173.3, "laps": 1,
  "physics": "dynamic", "draft": "solo", "profile": true,
  "combos": 11239, "sims": 52, "offset": 0, "searching": false
}
```

| Field | Meaning |
| --- | --- |
| `host` | The public hostname the request arrived at, from the `Host` header. Separates production (`zwiftbikes.com`), the `*.workers.dev` default and preview URLs. Group queries **by** host rather than filtering on one name, or traffic through the other door is silently missing. |
| `reqId` | Correlation id for tying a log line to a bug report or to its Workers Logs invocation when several similar requests land close together. |
| `cold` | First request this **isolate** served. Note it is not necessarily the request that paid the catalog init: if the isolate served something cheap first (a sitemap fetch, a 404), that one is flagged `cold` and a later request wears the init. To find requests that actually paid it, filter on `phases.pool > 500` instead - a count that cannot be argued with. |
| `pool` | Building the candidate pool: ownership/cosmetic/verified filters plus `classifyBikeFrame` for every frame at the rider's upgrade level. Warm isolates read ~1 ms; a fresh isolate pays the full lazy catalog init here (there is no pre-warm window on Workers - see "Cold starts" below). |
| `rank` | `rankCombos` over the full frame x wheelset matrix. |
| `geometry` | Route/segment geometry and the TTT power plan. |
| `estimate` | The closed-form `estimateFinishTimeSec` pass over the whole pool. |
| `filter` | `searchCombos` / `capWheelsetsPerFrame`. |
| `simulate` | `simulateRoute` - the per-metre integration. Normally the dominant phase. |
| `page` | Surface penalties and final ordering for the returned page. |
| `extras` | The solo-vs-draft and fastest-overall disclosures (extra simulations). |
| `sims` | How many full integrations ran. `simulate` = `sims` x one route; the segments endpoint runs two per candidate (warmed minus warmup-only). |

Non-API requests (SSR page renders) get `path`, `status`, `totalMs` and an
empty `phases` - useful on its own, since a page render's own internal API
call is logged as its own nested line.

**Nothing rider-identifying is logged.** The query string is dropped before
the line is written - `/api/recommend/*` carries weight, height and w/kg in
it - and only the request-shape fields above are kept.

## Querying in Workers Logs

Enabled by the `observability` block in wrangler.jsonc. In the dashboard:
**Workers & Pages -> the Worker -> Observability**. Because the line is a
JSON object, Workers Logs indexes every field: filter on `evt = request`,
then slice by any field above - `path`, `route`, `cold`, `physics` - and
aggregate `totalMs` or any `phases.*` value (p50/p95) grouped by any other.
The queries the old Application Insights setup needed KQL for are filter +
group-by clicks here:

- **Slowest routes**: filter `evt = request`, group by `route`, aggregate
  p95 of `totalMs` (add `distanceKm` and `sims` averages to see whether it's
  distance or pool depth).
- **Phase contribution**: filter `path` starts with `/api/recommend/`,
  aggregate p95 of `phases.pool`, `phases.estimate`, `phases.simulate`.
- **Cold-start tail**: group by `cold`, compare p95 of `totalMs`; or count
  `phases.pool > 500` for requests that actually paid the catalog init.

Alongside each request's own line, the platform writes an **invocation log**
with request/response metadata - including the invocation's CPU time and wall
time, which is the number the `cpu_ms` limit in wrangler.jsonc is enforced
against. The `simulate` phase should track CPU time closely (the handlers do
no I/O); a growing gap between the two is itself a finding.

For a live view during a deploy or an incident: `npx wrangler tail` streams
the same lines to a terminal.

**Volume and retention**: the paid plan includes 20M log events/month
($0.60/M beyond), with 7-day retention. At this site's traffic that is
nowhere near a concern; if it ever is, `head_sampling_rate` under
`observability` in wrangler.jsonc is the knob (it samples whole invocations,
so a sampled-out request loses its line and its invocation log together).

## Cold starts

There is no pre-warm window on Workers: an isolate is created because a
request arrived, module evaluation and the first-touch catalog init happen on
that request, and the init lands in its `pool` phase. (The old Azure setup
warmed the catalog from a startup plugin, exploiting the ~2-minute gap
between process start and first request that the Functions host provided.
That plugin is gone: on Workers, Nitro plugins run during module evaluation
in the isolate's **global scope**, which has a hard 400ms startup CPU limit -
a multi-second catalog warm there could fail deployment outright, and there
is no idle window for it to hide in anyway.)

The init used to be expensive - **4-11.5s of CPU** on production hardware,
nearly all of it `solveEquipmentDelta` runs for every measured frame x level
and wheel. Those solves now happen at build time
(`shared/data/equipmentPhysics.generated.json`, see
`scripts/equipment-physics/compute-equipment-physics.mjs`), so a cold
isolate's first-touch init is table lookups plus evaluating the 2MB route
surface JSON - ~50ms locally, expected well under a second in production.
A sustained return of large `phases.pool` values on cold isolates
(`phases.pool > 500`) is the regression signal that something expensive
crept back into first-touch init.

## Operational notes

- **Turning it off**: set the `TIMING_LOG=off` environment variable (a
  `vars` entry in wrangler.jsonc, or the dashboard's Settings -> Variables)
  to stop the JSON lines. The `Server-Timing` header keeps working
  regardless - it costs nothing and never leaves the response.
- **Prerendering is not logged**: the plugin sits out the prerender pass, so
  the 335 route pages built by `npm run build` produce no lines and no
  headers.
- **Static assets are invisible here**: prerendered pages and assets are
  served by the platform without invoking the Worker, so they produce no
  lines - only SSR renders and API calls appear.
- **Client-side timing** is not collected. The header is there for it -
  `PerformanceResourceTiming.serverTiming` exposes these same numbers to the
  browser - but nothing currently ships them anywhere.

## What normal looks like

Measured on Azure production after the August 2026 fixes; treat as the shape
to expect, not the numbers - **re-baseline after the Cloudflare cutover**
(different CPUs, different cold-start profile, and `pool` now pays catalog
init on every fresh isolate rather than once per rarely-recycled instance):

| | total | `pool` | `estimate` | `simulate` |
| --- | --- | --- | --- | --- |
| short route (<20 km, ~67% of traffic) | 60-90 ms | ~1 ms | 45-55 ms | single-digit ms |
| long route (173 km PRL Full, ~4% of traffic) | ~2.0 s | ~1 ms | ~50 ms | ~1.9 s |

`estimate` being the largest phase on a short route is expected: it is the
closed-form pass over the whole ~7000-combo pool, and it exists so that
ranking and search see every candidate. `simulate` dominating a long route is
also expected - that is the actual physics, ~60 route integrations, and the
worst legitimate request: seconds of genuinely CPU-bound work, which is why
`limits.cpu_ms` in wrangler.jsonc is generous - it is a runaway guard, not a
budget. A `cpuTime` kill shows up as `outcome: exceededCpu` (a 503) in
Workers Logs and `wrangler tail`.

For context on why those numbers are what they are: a typical request was
~900 ms until frame classification was cached (it was re-classifying all 166
frames per request), and the sub-20 km p95 was 2173 ms until catalog init
stopped being paid per request.

## History: the Azure version

Until the Cloudflare migration this doc described a three-sink setup:
the same header and stdout line, plus Application Insights custom telemetry
(`server/utils/appInsights.ts`, hand-rolled Breeze-protocol POSTs) and a
startup warmup plugin (`server/plugins/warmup.ts`). Both were deleted with
the migration - the telemetry sink because Workers Logs ingests the
structured line directly, making a second delivery path redundant; the
warmup for the reasons under "Cold starts". If a future host needs a push
sink again, git history has a batched, SDK-free reference implementation.
