import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { flushTelemetry, trackRequest } from '../utils/appInsights'
import { getRequestTiming, phasesObject, roundMs, serverTimingHeader, startRequestTiming } from '../utils/timing'

/**
 * How many requests this instance has served. Only the first one is marked
 * `cold`, which is the whole point of tracking it: a fresh Static Web Apps
 * managed function pays for the container start, the module graph and this
 * app's lazy catalog init (classifying 166 frames, loading the route surface
 * data) before it can answer, and that cost lands on ONE unlucky rider rather
 * than being spread across the p50. Without this flag those requests look
 * like an unexplained fat tail on otherwise identical work.
 */
let servedRequests = 0

/**
 * The public hostname the request arrived at, or undefined if neither header
 * is usable. Never throws - a malformed header must not cost a response.
 */
function requestHost(event: H3Event): string | undefined {
  const originalUrl = getRequestHeader(event, 'x-ms-original-url')
  if (originalUrl) {
    try {
      return new URL(originalUrl).host
    } catch {
      // Fall through to the Host header.
    }
  }
  return getRequestHeader(event, 'host')
}

/**
 * Request timing -> `Server-Timing` header + one JSON line per request for
 * Application Insights. See server/utils/timing.ts for what the pieces are
 * and docs/observability.md for how to query them.
 */
export default defineNitroPlugin((nitroApp) => {
  // Prerendering pushes all 335 route pages through this same nitro app at
  // build time. Timing those is meaningless (no rider is waiting) and the log
  // lines would bury the build output, so the hooks are never registered for
  // that pass - `markPhase` in the handlers degrades to a no-op on its own.
  if (import.meta.prerender) return

  nitroApp.hooks.hook('request', (event) => {
    startRequestTiming(event)
  })

  // `beforeResponse` rather than `afterResponse`: the headers are still
  // writable here, and the body hasn't been handed to the platform yet.
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const timing = getRequestTiming(event)
    if (!timing) return
    setResponseHeader(event, 'Server-Timing', serverTimingHeader(timing, performance.now() - timing.startedMs))
  })

  nitroApp.hooks.hook('afterResponse', async (event) => {
    const timing = getRequestTiming(event)
    if (!timing) return
    const cold = ++servedRequests === 1

    // Path only, never the query string: /api/recommend/* carries the
    // rider's weight, height and w/kg in it, and none of that belongs in a
    // telemetry sink we keep for 90 days. The handlers pass the parts that
    // are safe and actually explain the duration (route, laps, draft mode)
    // through `addTimingMeta` instead.
    const path = event.path.split('?')[0]!
    // Which environment served this. Preview deployments (one per open PR)
    // inherit production's application settings, so they report into the SAME
    // Application Insights resource - without this dimension their rows are
    // indistinguishable from production's. SWA's front end passes the public
    // URL it matched in `x-ms-original-url`, which is the preview hostname on
    // a preview environment; the azure-swa preset reads the path out of that
    // same header and drops the rest.
    const host = requestHost(event)
    const status = getResponseStatus(event)
    const totalMs = roundMs(performance.now() - timing.startedMs)
    // Only meaningful on the cold request: Node's `performance.now()` is
    // relative to process start, so at the first request it reads as
    // "how long this instance took to become able to serve anything".
    const bootMs = cold ? roundMs(timing.startedMs) : undefined
    const phases = phasesObject(timing)
    // Shared by the stdout line and the Application Insights telemetry so a
    // customEvents row can be joined back to its trace (and vice versa) - the
    // Functions host stamps its own unrelated operation id on the traces.
    const operationId = randomUUID().replaceAll('-', '')

    trackRequest({ path, host, method: event.method, status, operationId, totalMs, cold, bootMs, phases, meta: timing.meta })

    if (process.env.TIMING_LOG !== 'off') {
      console.log(JSON.stringify({
        evt: 'request',
        reqId: operationId,
        host,
        path,
        status,
        totalMs,
        cold,
        bootMs,
        phases,
        ...timing.meta
      }))
    }

    // Resolves immediately unless this request completed a batch or the last
    // one went out more than a few seconds ago - see `flushTelemetry`.
    await flushTelemetry()
  })
})
