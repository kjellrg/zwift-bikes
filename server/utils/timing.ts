import type { H3Event } from 'h3'

/**
 * Per-request phase timing, emitted two ways:
 *
 * - a `Server-Timing` response header, so a slow response breaks down by
 *   phase in any browser's network panel without a portal login;
 * - one JSON line per request on stdout. Azure's Functions host forwards
 *   what the function writes to stdout to Application Insights as a `traces`
 *   row, so `parse_json(message)` in the Logs blade turns these into a
 *   queryable table - see docs/observability.md for the queries.
 *
 * App Insights' own `requests` table can't answer "what is slow" here: on
 * Static Web Apps every SSR page render and every API call enters through the
 * SAME managed function (`navigationFallback` rewrites everything to
 * /api/server - see the generated staticwebapp.config.json), so all traffic
 * collapses onto one operation name with one duration distribution. The
 * `path` on these lines is the real request path, which the azure-swa
 * preset's function entry recovers from `x-ms-original-url` before nitro sees
 * it.
 *
 * Handlers stay ignorant of all of that: they call `markPhase()` at the seams
 * worth separating and `addTimingMeta()` for the few numbers that explain the
 * shape of the work (how many simulations, which route, how long it is). The
 * plugin in server/plugins/timing.ts starts the timer, writes the header and
 * emits the line.
 */

export type TimingMetaValue = string | number | boolean | undefined

export interface RequestTiming {
  /**
   * `performance.now()` when the request entered nitro. Node's clock is
   * relative to process start, which is what makes the first request's value
   * a usable cold-start measurement rather than an arbitrary offset.
   */
  readonly startedMs: number
  /** End of the last completed phase - `markPhase` only measures the gap since this. */
  lastMs: number
  /**
   * Insertion-ordered, so the header and the log line both read in execution
   * order. A repeated mark of the same name ACCUMULATES rather than
   * overwriting: the recommend endpoint simulates in three separate places
   * (ordering window, page fill, the solo/fastest-overall disclosures) and
   * all of it is the same cost centre.
   */
  readonly phases: Map<string, number>
  readonly meta: Record<string, TimingMetaValue>
}

/**
 * Keyed by event rather than stashed on `event.context` so nothing has to
 * augment h3's context type, and so a request that ends without a response
 * (a thrown error, a client disconnect) can't leak the entry.
 */
const timings = new WeakMap<H3Event, RequestTiming>()

/** Tenths of a millisecond - enough resolution for a 5ms phase, short enough to keep the log line readable. */
function round(ms: number): number {
  return Math.round(ms * 10) / 10
}

export function startRequestTiming(event: H3Event): RequestTiming {
  const startedMs = performance.now()
  const timing: RequestTiming = { startedMs, lastMs: startedMs, phases: new Map(), meta: {} }
  timings.set(event, timing)
  return timing
}

export function getRequestTiming(event: H3Event): RequestTiming | undefined {
  return timings.get(event)
}

/**
 * Closes the phase that ended here and opens the next one.
 *
 * A no-op when no timer was started for this event, which is the normal case
 * during prerendering (the plugin sits out that pass entirely) - so handlers
 * can mark unconditionally.
 */
export function markPhase(event: H3Event, phase: string): void {
  const timing = timings.get(event)
  if (!timing) return
  const now = performance.now()
  timing.phases.set(phase, (timing.phases.get(phase) ?? 0) + (now - timing.lastMs))
  timing.lastMs = now
}

/** Adds request-shape fields to the log line. Never anything rider-identifying - see the plugin. */
export function addTimingMeta(event: H3Event, fields: Record<string, TimingMetaValue>): void {
  const timing = timings.get(event)
  if (!timing) return
  Object.assign(timing.meta, fields)
}

/**
 * `total;dur=2371.4, pool;dur=1.2, rank;dur=4.1, ...` - the phases in the
 * order they ran, total first so it's readable even where the panel truncates.
 */
export function serverTimingHeader(timing: RequestTiming, totalMs: number): string {
  const parts = [`total;dur=${round(totalMs)}`]
  for (const [phase, ms] of timing.phases) parts.push(`${phase};dur=${round(ms)}`)
  return parts.join(', ')
}

export function phasesObject(timing: RequestTiming): Record<string, number> {
  const phases: Record<string, number> = {}
  for (const [phase, ms] of timing.phases) phases[phase] = round(ms)
  return phases
}

export { round as roundMs }
