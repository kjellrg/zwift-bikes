import { runWarmup } from '../utils/warmup'

/**
 * Warms the catalog at startup - see server/utils/warmup.ts for why, and for
 * what decides whether it works on Static Web Apps.
 */
export default defineNitroPlugin(() => {
  // Prerendering builds 335 pages through this same app at build time. The
  // catalog gets built there either way by the first page rendered, and a
  // deliberate warm would only add a line of noise to the build.
  if (import.meta.prerender) return

  // Synchronous on purpose. A request arriving mid-warm would otherwise
  // trigger the same lazy init concurrently and both would do the work; the
  // event loop is idle at this point anyway, since nothing has been routed to
  // this process yet.
  runWarmup()
})
