import type { H3Event } from 'h3'

/**
 * Per-request phase timing, emitted two ways:
 *
 * - a `Server-Timing` response header, so a slow response breaks down by
 *   phase in any browser's network panel without a dashboard login;
 * - one JSON line per request via `console.log`. Workers Logs (enabled by
 *   `observability` in wrangler.jsonc) ingests it as a structured event, so
 *   every field is filterable in the dashboard - see docs/observability.md.
 *
 * Handlers stay ignorant of all of that: they call `markPhase()` at the seams
 * worth separating and `addTimingMeta()` for the few numbers that explain the
 * shape of the work (how many simulations, which route, how long it is). The
 * plugin in server/plugins/timing.ts starts the timer, writes the header and
 * emits the line.
 *
 * THE CLOCK NEEDS HELP ON WORKERS: as a Spectre mitigation, a deployed
 * Worker's `performance.now()`/`Date.now()` only advance when the isolate
 * returns to the event loop for I/O - between two reads separated by pure
 * computation they return the SAME value, which would zero out every phase
 * here (the recommend handlers are pure CPU end to end). `advanceClock()`
 * below is the workaround: awaiting a zero-delay timer is such a return to
 * the event loop, after which the clock reflects real time again. That is
 * why `markPhase` is async. In local dev (Node, and `wrangler dev`, whose
 * clocks advance regardless) it degrades to one cheap macrotask hop.
 */

export type TimingMetaValue = string | number | boolean | undefined

export interface RequestTiming {
  /**
   * `performance.now()` when the request entered nitro. Fresh at that point
   * without any help: delivering the request to the isolate is itself an
   * I/O event, which is when the Workers clock updates.
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
 * Minimal Cache API surface - `caches.default` exists on Workers, not in
 * Node, and neither environment's ambient types declare it here.
 */
interface WorkersCaches {
  default?: { match(url: string): Promise<unknown> }
}

/**
 * Lets the Workers clock catch up with reality - see the module comment.
 * Awaited before every clock read that follows CPU-bound work.
 *
 * A zero-delay timer is NOT enough: timers fire without the runtime
 * considering them I/O (verified on a deployed Worker - every phase read 0
 * while the same build measured fine under `wrangler dev`, whose clocks
 * advance freely). A Cache API read is real I/O to the colo's cache layer,
 * so the clock is current after it; the key is never written, so the lookup
 * is a guaranteed miss costing well under a millisecond, attributed to
 * whichever phase is being closed. Outside Workers (`nuxt dev`, Node) there
 * is no `caches.default` and no frozen clock - a macrotask hop keeps the
 * await semantics identical there.
 */
export async function advanceClock(): Promise<void> {
  const caches = (globalThis as { caches?: WorkersCaches }).caches
  if (caches?.default) {
    await caches.default.match('https://internal/timing-clock-tick')
    return
  }
  await new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Closes the phase that ended here and opens the next one. Must be awaited -
 * the clock only advances past the phase's CPU work after `advanceClock()`.
 *
 * A no-op when no timer was started for this event, which is the normal case
 * during prerendering (the plugin sits out that pass entirely) - so handlers
 * can mark unconditionally.
 */
export async function markPhase(event: H3Event, phase: string): Promise<void> {
  const timing = timings.get(event)
  if (!timing) return
  await advanceClock()
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
