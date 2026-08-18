import type { TimingMetaValue } from './timing'

/**
 * Application Insights custom telemetry, posted straight to the ingestion
 * endpoint.
 *
 * Why not the SDK: `@azure/monitor-opentelemetry` (and the classic
 * `applicationinsights` package it replaced) pulls in the OpenTelemetry
 * runtime and patches Node's http stack at startup. That cost lands on
 * process start - which is precisely the cold-start latency this telemetry
 * exists to measure, so instrumenting it that way would inflate the number it
 * reports. It also has to survive nitro's rollup bundle into a single Azure
 * Function, which its dynamic requires make fragile. The wire format is a
 * plain JSON POST (the "Breeze" endpoint protocol), so the whole dependency
 * buys nothing here that ~100 lines don't.
 *
 * What this sends, per request:
 *
 * - one `customEvents` row (`server.request`) carrying every phase as a
 *   measurement and the request shape as dimensions. This is the one to rank
 *   with - `customEvents` keeps all dimensions, so a "slowest routes" query
 *   is a `summarize ... by tostring(customDimensions.route)` with no
 *   `parse_json` anywhere;
 * - one or two `customMetrics` rows, which Azure ALSO forwards to the
 *   pre-aggregated metric store, where they can drive Metrics-blade charts
 *   and true metric alerts. Note the store drops dimensions unless the
 *   "Send custom metrics to Azure Metric Store - With dimensions" preview is
 *   turned on for the resource (Usage and estimated costs); the
 *   `customMetrics` log table keeps them either way. See
 *   docs/observability.md.
 *
 * The stdout JSON line in server/plugins/timing.ts stays the lossless copy:
 * it costs nothing, can't be dropped by a failed POST, and works on any host
 * (including a non-Azure one).
 */

/** Default Breeze endpoint, used when only an instrumentation key is configured. */
const DEFAULT_INGESTION_ENDPOINT = 'https://dc.services.visualstudio.com'

/**
 * Envelopes are batched rather than posted per request: at one POST per
 * request the ingestion round trip would sit on the critical path of every
 * response, which is a strange thing to do in the name of measuring latency.
 * A batch of this size costs one flush per ~24 requests.
 */
const BATCH_SIZE = 24

/** ...and a slow trickle of traffic still gets its telemetry out within this. */
const MAX_BATCH_AGE_MS = 10_000

/** Hard ceiling on a stalled or unreachable endpoint. A rider's request never waits longer than this for telemetry. */
const FLUSH_TIMEOUT_MS = 1000

/** Bounds memory if the endpoint is down for a long time - oldest envelopes are dropped first. */
const MAX_PENDING = 200

interface IngestionTarget {
  url: string
  instrumentationKey: string
}

interface Envelope {
  name: string
  time: string
  iKey: string
  tags: Record<string, string>
  data: { baseType: string, baseData: Record<string, unknown> }
}

let resolved = false
let target: IngestionTarget | undefined

/**
 * Reads the connection string Azure sets when Application Insights is linked
 * to the static web app. Both spellings are accepted: current deployments get
 * `APPLICATIONINSIGHTS_CONNECTION_STRING`, older ones only ever had the bare
 * `APPINSIGHTS_INSTRUMENTATIONKEY`, which implies the global endpoint.
 */
function ingestionTarget(): IngestionTarget | undefined {
  if (resolved) return target
  resolved = true

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  if (connectionString) {
    const fields = new Map(
      connectionString.split(';')
        .map(pair => pair.split(/=(.*)/s))
        .filter(parts => parts.length >= 2)
        .map(([key, value]) => [key!.trim().toLowerCase(), value!.trim()])
    )
    const instrumentationKey = fields.get('instrumentationkey')
    if (instrumentationKey) {
      const endpoint = (fields.get('ingestionendpoint') || DEFAULT_INGESTION_ENDPOINT).replace(/\/+$/, '')
      target = { url: `${endpoint}/v2/track`, instrumentationKey }
    }
  } else if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY) {
    target = { url: `${DEFAULT_INGESTION_ENDPOINT}/v2/track`, instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATIONKEY }
  }

  return target
}

const pending: Envelope[] = []
/**
 * Seeded at module load rather than 0 so the age check below is meaningful
 * from the start: with 0 the very first request would trip an immediate
 * flush, putting an ingestion round trip on the one request that is already
 * paying for the cold start.
 */
let lastFlushMs = Date.now()
/** One warning per instance, not per failure: a broken endpoint must not turn into a log flood. */
let reportedFailure = false

/**
 * `ai.cloud.role` shows up as `cloud_RoleName` on every row, which is how
 * telemetry from a preview environment is told apart from production - they
 * share one Application Insights resource, because Static Web Apps copies
 * application settings into every staging environment.
 *
 * `TELEMETRY_ROLE` is the explicit lever for that: set it per environment
 * (the portal's Environment variables blade is per-environment) when the two
 * need different names. `WEBSITE_SITE_NAME` is the Azure-provided fallback,
 * and is not guaranteed to be present on managed functions - hence the
 * literal last resort, which is also what a non-Azure host would use.
 */
function commonTags(operationId: string, operationName: string): Record<string, string> {
  const tags: Record<string, string> = {
    'ai.cloud.role': process.env.TELEMETRY_ROLE || process.env.WEBSITE_SITE_NAME || 'zwiftbikes',
    'ai.operation.id': operationId,
    'ai.operation.name': operationName
  }
  const instance = process.env.WEBSITE_INSTANCE_ID
  // The instance id is what makes "is one unlucky container cold-starting
  // repeatedly?" answerable - it's the only field that distinguishes them.
  if (instance) tags['ai.cloud.roleInstance'] = instance.slice(0, 16)
  return tags
}

function enqueue(envelope: Envelope): void {
  pending.push(envelope)
  if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING)
}

export interface RequestTelemetry {
  path: string
  /** Public hostname - the dimension that separates preview environments from production. */
  host?: string
  method: string
  status: number
  operationId: string
  totalMs: number
  cold: boolean
  bootMs?: number
  /** Cold request only: how long the startup warm took, and whether it finished before this request. */
  warmupMs?: number
  warmedBefore?: boolean
  phases: Record<string, number>
  meta: Record<string, TimingMetaValue>
}

/**
 * Queues one `customEvents` row plus the metric-store counterparts. Never
 * throws and never awaits - delivery happens in `flushTelemetry()`, which the
 * plugin calls once the response is already built.
 */
export function trackRequest(telemetry: RequestTelemetry): void {
  const configured = ingestionTarget()
  if (!configured || process.env.TIMING_METRICS === 'off') return

  const time = new Date().toISOString()
  const operationName = `${telemetry.method} ${telemetry.path}`
  const tags = commonTags(telemetry.operationId, operationName)

  // Dimensions are strings by definition in this schema. Anything numeric
  // that belongs on a chart goes in `measurements` instead, which is why
  // `distanceKm`/`sims`/`combos` are not here.
  const properties: Record<string, string> = {
    path: telemetry.path,
    status: String(telemetry.status),
    cold: String(telemetry.cold)
  }
  if (telemetry.host) properties.host = telemetry.host
  for (const [key, value] of Object.entries(telemetry.meta)) {
    if (value === undefined || typeof value === 'number') continue
    properties[key] = String(value)
  }

  const measurements: Record<string, number> = { totalMs: telemetry.totalMs }
  for (const [phase, ms] of Object.entries(telemetry.phases)) measurements[`${phase}Ms`] = ms
  for (const [key, value] of Object.entries(telemetry.meta)) {
    if (typeof value === 'number') measurements[key] = value
  }
  if (telemetry.bootMs !== undefined) measurements.bootMs = telemetry.bootMs
  if (telemetry.warmupMs !== undefined) measurements.warmupMs = telemetry.warmupMs
  if (telemetry.warmedBefore !== undefined) properties.warmedBefore = String(telemetry.warmedBefore)

  enqueue({
    name: 'Microsoft.ApplicationInsights.Event',
    time,
    iKey: configured.instrumentationKey,
    tags,
    data: { baseType: 'EventData', baseData: { ver: 2, name: 'server.request', properties, measurements } }
  })

  const metric = (name: string, value: number): Envelope => ({
    name: 'Microsoft.ApplicationInsights.Metric',
    time,
    iKey: configured.instrumentationKey,
    tags,
    // The schema takes a list but stores exactly one point per envelope, so
    // each metric is its own envelope. `kind: 0` is a raw measurement (as
    // opposed to a pre-aggregated one carrying count/min/max).
    data: { baseType: 'MetricData', baseData: { ver: 2, metrics: [{ name, kind: 0, value, count: 1 }], properties } }
  })

  // Deliberately few: every metric name is its own time series in the metric
  // store, and the per-phase detail is already on the event above. These two
  // are the ones worth a Metrics-blade chart or an alert rule.
  enqueue(metric('server.request.ms', telemetry.totalMs))
  if (telemetry.phases.simulate !== undefined) enqueue(metric('recommend.simulate.ms', telemetry.phases.simulate))
}

/**
 * Posts the queued envelopes if the batch is full or stale. Resolves without
 * doing anything in the common case, so the plugin can await it on every
 * request.
 */
export async function flushTelemetry(): Promise<void> {
  const configured = ingestionTarget()
  if (!configured || pending.length === 0) return

  const now = Date.now()
  if (pending.length < BATCH_SIZE && now - lastFlushMs < MAX_BATCH_AGE_MS) return
  lastFlushMs = now

  const batch = pending.splice(0, pending.length)
  try {
    const response = await fetch(configured.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS)
    })
    if (!response.ok && !reportedFailure) {
      reportedFailure = true
      console.warn(`[telemetry] ingestion rejected ${batch.length} envelope(s) with HTTP ${response.status}; further failures are not logged`)
    }
  } catch (error) {
    // Telemetry is never worth failing or retrying a rider's request over.
    // The batch is dropped; the stdout lines in server/plugins/timing.ts
    // remain the lossless record of the same data.
    if (!reportedFailure) {
      reportedFailure = true
      console.warn(`[telemetry] ingestion POST failed, dropping ${batch.length} envelope(s): ${error instanceof Error ? error.message : String(error)}; further failures are not logged`)
    }
  }
}
