# Observability: where a request's time goes

Every request the server handles emits its own timing, three ways:

- a **`Server-Timing` response header**, visible per response in any browser's
  network panel (Chrome/Edge render it in the Timing tab as named bars);
- one **JSON line on stdout**, which Azure's Functions host forwards to
  Application Insights as a `traces` row;
- one **`customEvents` row plus two `customMetrics` points**, posted straight
  to the Application Insights ingestion endpoint - the rankable, alertable
  copy (see [Custom events and metrics](#custom-events-and-metrics)).

Both come from the same measurements: `server/plugins/timing.ts` starts a
timer on every request, the handlers call `markPhase()` at the seams worth
separating, `server/utils/timing.ts` holds the plumbing and
`server/utils/appInsights.ts` posts the telemetry.

## Why the custom lines exist at all

App Insights already records a `requests` row per invocation, but on Static
Web Apps that table can't tell you what is slow: **every** SSR page render and
**every** API call enters through the same managed function - the generated
`staticwebapp.config.json` rewrites all non-static traffic to `/api/server` -
so all of it collapses onto one operation name with one duration
distribution. The `path` field on these lines is the real request path (the
azure-swa preset recovers it from `x-ms-original-url` before nitro sees it),
which is what makes per-route and per-phase analysis possible.

## What a line looks like

```json
{
  "evt": "request",
  "reqId": "4a8db278a5f74946b7a98ee6cd0ee51a",
  "path": "/api/recommend/london-the-prl-full",
  "status": 200,
  "totalMs": 3074.7,
  "cold": true,
  "bootMs": 31117.6,
  "phases": { "pool": 505.5, "rank": 13.5, "geometry": 1.1, "estimate": 59.6,
              "filter": 3.5, "simulate": 2485.8, "page": 0.4, "extras": 0 },
  "route": "london-the-prl-full", "distanceKm": 173.3, "laps": 1,
  "physics": "dynamic", "draft": "solo", "profile": true,
  "combos": 11239, "sims": 52, "offset": 0, "searching": false
}
```

| Field | Meaning |
| --- | --- |
| `host` | The public hostname the request arrived at - `zwiftbikes.com` in production, the `…-<pr>.<region>.azurestaticapps.net` name on a preview environment. Read from `x-ms-original-url`, the header SWA's front end sets with the URL it matched. |
| `reqId` | Correlation id, also sent as `operation_Id` on the custom event and metrics - the join between a trace line and its rankable row. |
| `cold` | First request this instance ever served. The container start, module graph and lazy catalog init are all paid by that one rider. |
| `bootMs` | Only on a cold request: milliseconds from process start to the request arriving - i.e. how long the instance took to become able to answer. |
| `pool` | Building the candidate pool: ownership/cosmetic/verified filters plus `classifyBikeFrame` for every frame at the rider's upgrade level. Carries the lazy catalog load on a cold instance. |
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

## Custom events and metrics

The stdout lines above are the lossless record, but ranking on them means
`parse_json` in every query and they can't drive a metric alert. So the same
measurements also go to Application Insights as real telemetry:

| What | Where it lands | Use it for |
| --- | --- | --- |
| `server.request` event, one per request: every phase as a measurement, the request shape as dimensions | `customEvents` table | Ranking. All dimensions are kept, so slicing by route/physics/draft is a plain `summarize ... by tostring(customDimensions.route)`. |
| `server.request.ms` | `customMetrics` table **and** the pre-aggregated metric store | Metrics-blade charts, dashboards, metric alerts. |
| `recommend.simulate.ms` (recommend endpoints only) | same | Watching the physics cost specifically, separately from cold starts and framework overhead. |

Sent by `server/utils/appInsights.ts` as plain JSON POSTs to the ingestion
endpoint, with no SDK. That is deliberate: `@azure/monitor-opentelemetry`
would add the OpenTelemetry runtime and http patching to **process start**,
which is exactly the cold-start latency being measured here - the
instrumentation would inflate its own headline number - and it would have to
survive nitro's rollup bundle into a single Azure Function, which its dynamic
requires make fragile.

**Configuration**: Static Web Apps exposes its application settings to the
managed function as environment variables, and linking Application Insights
in the portal creates one of these to tie the two together. Both spellings
are read - `APPLICATIONINSIGHTS_CONNECTION_STRING` and the older
`APPINSIGHTS_INSTRUMENTATIONKEY`. Microsoft's docs don't name which one the
link creates, so confirm it once after enabling:

```bash
az staticwebapp appsettings list --name <app-name>
```

If neither name is there, copy the connection string from the Application
Insights resource overview and set it yourself:

```bash
az staticwebapp appsettings set --name <app-name> \
  --setting-names "APPLICATIONINSIGHTS_CONNECTION_STRING=<connection-string>"
```

With neither set - local dev, a fork, a preview build - `trackRequest` returns
immediately, nothing is posted, and only the stdout lines remain. That is the
intended failure mode: no telemetry is never a broken request.

### Preview environments

Application settings are copied into every staging environment, so **preview
deployments report into the same Application Insights resource as
production** - the connection string is there, the managed function is the
same build, and both sinks work identically. That makes a PR preview the
place to confirm the telemetry works before it reaches production traffic.

Preview rows are not mixed up with production ones: every row carries the
`host` dimension, which is the preview's own `…-<pr>.<region>.azurestaticapps.net`
hostname. To separate them by role instead - handy for Metrics-blade charts,
where `cloud_RoleName` is a first-class filter - set `TELEMETRY_ROLE` on the
preview environment (the portal's Environment variables blade is
per-environment).

Check a fresh deployment landed, newest first:

```kusto
customEvents
| where name == "server.request" and timestamp > ago(30m)
| summarize requests = count(),
            p95 = percentile(todouble(customMeasurements.totalMs), 95),
            last_seen = max(timestamp)
          by host = tostring(customDimensions.host)
| order by last_seen desc
```

Exclude previews from a production ranking with
`| where tostring(customDimensions.host) == "zwiftbikes.com"`.

**Delivery**: envelopes are batched (24, or 10 seconds, whichever comes
first) and posted with a 1 second timeout from the `afterResponse` hook, so
no rider's request waits on the ingestion endpoint for longer than that, and
only ~1 request in 24 pays a round trip at all. A failed POST drops that
batch, warns once per instance, and never fails the request; the same data is
still in `traces`. A partial batch on an instance that gets recycled is lost
for the same reason - accept it, or query `traces` where exactness matters.

**Dimensions in the metric store**: `customMetrics` (the log table) always
keeps `route`, `path`, `cold` and the rest. The pre-aggregated metric store
behind the Metrics blade drops them by default, so a Metrics-blade chart can
show overall p95 but can't split by route until you turn on *Send custom
metrics to Azure Metric Store -> With dimensions* under **Usage and estimated
costs**. That's a preview feature and it bills as custom metrics, so leave it
off unless you actually want per-route metric alerts - per-route ranking works
in Logs either way.

## Queries

In the portal: the App Insights resource next to the static web app ->
**Monitoring -> Logs**.

KQL reserves a number of short words - `kind`, `last` and `range` among them -
and rejects them as column aliases with a parse error rather than anything
self-explanatory. Hence `last_seen` and the `_p95` suffixes below;
bracket-quoting (`['last'] = max(timestamp)`) works too.

Slowest routes, ranked (the query to start from):

```kusto
customEvents
| where name == "server.request" and isnotempty(customDimensions.route)
| extend route = tostring(customDimensions.route)
| summarize calls = count(),
            p50 = percentile(todouble(customMeasurements.totalMs), 50),
            p95 = percentile(todouble(customMeasurements.totalMs), 95),
            simulate_p95 = percentile(todouble(customMeasurements.simulateMs), 95),
            km = avg(todouble(customMeasurements.distanceKm)),
            sims = avg(todouble(customMeasurements.sims))
          by route
| order by p95 desc
| take 25
```

Phase contribution to the p95, ranked - which phase to attack first:

```kusto
customEvents
| where name == "server.request" and tostring(customDimensions.path) startswith "/api/recommend/"
| summarize total_p95 = percentile(todouble(customMeasurements.totalMs), 95),
            pool_p95 = percentile(todouble(customMeasurements.poolMs), 95),
            rank_p95 = percentile(todouble(customMeasurements.rankMs), 95),
            estimate_p95 = percentile(todouble(customMeasurements.estimateMs), 95),
            simulate_p95 = percentile(todouble(customMeasurements.simulateMs), 95),
            extras_p95 = percentile(todouble(customMeasurements.extrasMs), 95)
```

Cold starts, ranked against warm requests:

```kusto
customEvents
| where name == "server.request"
| extend cold = tostring(customDimensions.cold)
| summarize requests = count(),
            p50 = percentile(todouble(customMeasurements.totalMs), 50),
            p95 = percentile(todouble(customMeasurements.totalMs), 95),
            boot_p95 = percentile(todouble(customMeasurements.bootMs), 95)
          by cold
```

The metric-store copy, for a chart or an alert rule:

```kusto
customMetrics
| where name == "server.request.ms"
| summarize p95 = percentile(valueMax, 95) by bin(timestamp, 5m)
| render timechart
```

Joining a ranked row back to its raw trace line:

```kusto
customEvents
| where name == "server.request" and todouble(customMeasurements.totalMs) > 3000
| project timestamp, operation_Id, route = tostring(customDimensions.route)
| join kind=inner (traces | extend d = parse_json(message) | project operation_Id = tostring(d.reqId), message) on operation_Id
```

### Querying the raw trace lines

Everything above also works against `traces` when the custom telemetry is
off or a batch was lost.

Slowest paths:

```kusto
traces
| extend d = parse_json(message)
| where d.evt == "request"
| summarize calls = count(),
            p50 = percentile(todouble(d.totalMs), 50),
            p95 = percentile(todouble(d.totalMs), 95)
          by path = tostring(d.path)
| order by p95 desc
```

Where the time goes inside the recommend endpoint:

```kusto
traces
| extend d = parse_json(message)
| where d.evt == "request" and tostring(d.path) startswith "/api/recommend/"
| summarize p95_total = percentile(todouble(d.totalMs), 95),
            p95_pool = percentile(todouble(d.phases.pool), 95),
            p95_estimate = percentile(todouble(d.phases.estimate), 95),
            p95_simulate = percentile(todouble(d.phases.simulate), 95)
          by bin(timestamp, 1h)
| render timechart
```

How much of the tail is cold starts:

```kusto
traces
| extend d = parse_json(message)
| where d.evt == "request"
| summarize requests = count(),
            cold = countif(d.cold == true),
            p95_boot = percentile(todouble(d.bootMs), 95)
          by bin(timestamp, 1d)
```

Which routes are slow, and whether it's distance or pool depth:

```kusto
traces
| extend d = parse_json(message)
| where d.evt == "request" and isnotnull(d.route)
| summarize calls = count(),
            p95 = percentile(todouble(d.totalMs), 95),
            km = any(todouble(d.distanceKm)),
            sims = avg(todouble(d.sims))
          by route = tostring(d.route)
| order by p95 desc
| take 25
```

Simulation cost against route length (the relationship should be linear - a
point off the line means a route whose geometry, not its distance, is the
problem):

```kusto
traces
| extend d = parse_json(message)
| where d.evt == "request" and isnotnull(d.route)
| project km = todouble(d.distanceKm), simulateMs = todouble(d.phases.simulate)
| render scatterchart
```

## Operational notes

- **Turning it off**: `TIMING_LOG=off` stops the stdout lines,
  `TIMING_METRICS=off` stops the custom events and metrics. Both are Static
  Web Apps app settings, and either can be set without touching the other.
  The `Server-Timing` header keeps working regardless - it costs nothing and
  never leaves the response.
- **Cost**: three telemetry items per request (one event, two metric points)
  on top of the trace line. At this site's traffic that is negligible, but it
  IS the knob to turn first if the App Insights bill ever looks wrong -
  `TIMING_METRICS=off` halves the volume and leaves ranking possible through
  `traces`.
- **Sampling**: the `host.json` the azure-swa preset generates is bare
  (`{"version": "2.0"}`), so the Functions host's default adaptive sampling
  applies - it only starts dropping telemetry above ~20 items/second, which
  this site is nowhere near. If lines ever go missing at traffic, that's why,
  and the fix is to patch `host.json` after the build the way
  `scripts/trim-swa-config.mjs` patches the SWA config.
- **Prerendering is not logged**: the plugin sits out the prerender pass, so
  the 335 route pages built by `npm run build` produce no lines and no
  headers.
- **The flush is on the request's critical path here**, unlike on a normal
  Node server. Under the azure-swa preset the function entry calls
  `nitroApp.localCall()` and only returns a response once that resolves, and
  h3 awaits the `afterResponse` hook inside it - so the batched POST finishes
  before the rider gets their bytes. That is what makes delivery reliable on a
  function that may be frozen straight after the invocation, and why the batch
  size and the 1 second timeout matter: at most one request in 24 pays for it,
  and never more than a second.

## Moving off Azure

The instrumentation is deliberately split so only one file knows about Azure:

| File | Host-specific? |
| --- | --- |
| `server/utils/timing.ts` | No. Phase timing and the `Server-Timing` header - plain h3. |
| `server/plugins/timing.ts` | No. Nitro hooks; the stdout JSON line works anywhere that captures stdout. |
| `server/api/recommend/**` `markPhase`/`addTimingMeta` calls | No. They name phases, nothing else. |
| `server/utils/appInsights.ts` | **Yes** - the Breeze envelope format and the two Azure environment variables. |

On a **standard Azure Web App** (nitro's `node-server` preset) the custom
events and metrics work unchanged - `APPLICATIONINSIGHTS_CONNECTION_STRING` is an ordinary
application setting there. The stdout lines are the part that differs: they go
to the App Service log stream rather than becoming `traces` rows, since it's
the Functions host that does that forwarding on SWA. Point a diagnostic
setting at the workspace if you want them queryable there too.

On a host that isn't Azure, `appInsights.ts` finds no connection string and
does nothing - no code change needed to move; the header and the stdout lines
keep working, and the phase data is still there. To wire up a new backend,
replace that one file and the two functions the plugin imports from it
(`trackRequest`, `flushTelemetry`). On AWS that is a smaller job than it
looks: CloudWatch Logs already ingests stdout, and CloudWatch's Embedded
Metric Format is the same JSON line with an `_aws` block added, so the
existing log line becomes queryable metrics without a network call at all.

To remove the whole thing instead: delete the plugin and the two utils, then
drop the `markPhase`/`addTimingMeta` calls from the two recommend handlers -
they are the only places any of it is referenced.
- **Client-side timing** is not collected. The header is there for it -
  `PerformanceResourceTiming.serverTiming` exposes these same numbers to the
  browser - but nothing currently ships them anywhere.
