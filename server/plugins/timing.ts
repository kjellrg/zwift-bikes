import { advanceClock, getRequestTiming, phasesObject, roundMs, serverTimingHeader, startRequestTiming } from '../utils/timing'

/**
 * How many requests this isolate has served. Only the first one is marked
 * `cold`, which is what makes cold starts visible in the logs: a fresh
 * Workers isolate pays for module evaluation plus this app's lazy catalog
 * init (classifying 166 frames, loading the route surface data) inside the
 * first request that touches it - it lands in that request's `pool` phase -
 * and that cost hits ONE unlucky rider rather than being spread across the
 * p50. Without this flag those requests look like an unexplained fat tail on
 * otherwise identical work.
 */
let servedRequests = 0

/**
 * Request timing -> `Server-Timing` header + one structured JSON line per
 * request for Workers Logs. See server/utils/timing.ts for what the pieces
 * are and docs/observability.md for how to query them.
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
  // writable here, and the body hasn't been handed to the platform yet. The
  // clock hop is what makes the total include the tail since the handler's
  // last `markPhase` - see `advanceClock`.
  nitroApp.hooks.hook('beforeResponse', async (event) => {
    const timing = getRequestTiming(event)
    if (!timing) return
    await advanceClock()
    setResponseHeader(event, 'Server-Timing', serverTimingHeader(timing, performance.now() - timing.startedMs))
  })

  nitroApp.hooks.hook('afterResponse', (event) => {
    const timing = getRequestTiming(event)
    if (!timing) return
    const cold = ++servedRequests === 1

    // Path only, never the query string: /api/recommend/* carries the
    // rider's weight, height and power in it, and none of that belongs in a
    // log sink. The handlers pass the parts that are safe and actually
    // explain the duration (route, laps, draft mode) through `addTimingMeta`
    // instead.
    const path = event.path.split('?')[0]!
    // Which environment served this: the Worker sees the public hostname
    // directly, so production, workers.dev and preview-URL traffic separate
    // on this one field.
    const host = getRequestHeader(event, 'host')
    const status = getResponseStatus(event)
    // The clock is current here without help: sending the response (in
    // `beforeResponse` above, which also hopped the event loop) was I/O.
    const totalMs = roundMs(performance.now() - timing.startedMs)
    // Correlates a log line with a bug report or a Workers Logs invocation
    // when several similar requests land close together.
    const reqId = crypto.randomUUID().replaceAll('-', '')

    if (process.env.TIMING_LOG !== 'off') {
      console.log(JSON.stringify({
        evt: 'request',
        reqId,
        host,
        path,
        status,
        totalMs,
        cold,
        phases: phasesObject(timing),
        ...timing.meta
      }))
    }
  })
})
