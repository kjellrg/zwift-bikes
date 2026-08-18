import { getFrames, getRoutesWithMeta } from '../../shared/utils/catalog'
import { getWheelsets } from '../../shared/utils/wheelsets'
import { classifyBikeFrame, DEFAULT_UNOWNED_LEVEL } from '../../shared/utils/classifyBikeFrame'

/**
 * Builds the catalog once, at process start, instead of inside whichever
 * request happens to touch it first.
 *
 * The catalog is lazy: `getFrames()` classifies every frame, `getRoutesWithMeta()`
 * parses the route surface and terrain data, and both memoize. That work costs
 * ~2.3s on the Static Web Apps function, and until now it landed inside a
 * rider's request - 5.8% of production requests were paying it, which is what
 * put a 2173ms p95 on sub-20km routes whose physics takes single-digit
 * milliseconds.
 *
 * Whether this actually helps depends on something Azure does not document
 * clearly: the Functions host starts a worker process well before it routes
 * the first request (telemetry showed processes 118 seconds old when they
 * served their first), but the entry module has to be LOADED in that window
 * too for a startup plugin to run in it. If the host loads modules eagerly at
 * function-load, this moves the whole 2.3s off the request path. If it loads
 * them lazily on first invocation, the first request pays exactly what it pays
 * today and nothing is lost. `warmup.finishedBeforeFirstRequest` (reported on
 * the cold request, see server/plugins/timing.ts) is what tells the two apart.
 */

interface WarmupState {
  /** How long the warm took. `undefined` until it has run. */
  durationMs?: number
  /** `performance.now()` when it finished - comparable to a request's start. */
  finishedAtMs?: number
}

export const warmup: WarmupState = {}

export function runWarmup(): void {
  if (warmup.finishedAtMs !== undefined) return

  const startedMs = performance.now()

  // Same three calls the recommend endpoints make, in the same order, so the
  // work being warmed is exactly the work being skipped - not an approximation
  // of it. Classification at `DEFAULT_UNOWNED_LEVEL` covers the rider who has
  // not set up a garage, which is the common case; a rider with per-frame
  // levels still classifies those frames on demand, and the cache introduced
  // in #107 keeps that to once per level.
  const frames = getFrames()
  getWheelsets()
  getRoutesWithMeta()
  for (const frame of frames) classifyBikeFrame(frame, DEFAULT_UNOWNED_LEVEL)

  warmup.finishedAtMs = performance.now()
  warmup.durationMs = Math.round((warmup.finishedAtMs - startedMs) * 10) / 10
}
