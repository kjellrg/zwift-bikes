/**
 * Security headers for WORKER-GENERATED responses: SSR page renders (e.g.
 * /segments/**), every /api/** response, and errors. Statically served
 * responses never reach this middleware - the assets binding answers them
 * first - and get the SAME set from public/_headers; keep the two in sync.
 *
 * The `00.` prefix makes this the first middleware Nitro runs (ordering is
 * by filename), so responses thrown by the later gates (origin-gate's 403,
 * rate-limit's 429, site-flags-gate's 503) carry the headers too.
 *
 * No full script CSP on purpose: Nuxt hydration relies on inline scripts, so
 * anything stronger than frame-ancestors would need 'unsafe-inline' and
 * protect nothing. frame-ancestors 'none' (+ the X-Frame-Options fallback
 * for older UAs) is the part that's free.
 */
export default defineEventHandler((event) => {
  if (import.meta.prerender) return
  // No Strict-Transport-Security or X-Content-Type-Options here: the zone
  // sets both at the Cloudflare edge, which covers every hostname on the
  // domain - duplicating them at the origin only creates two places for the
  // values to drift. (workers.dev previews miss the zone's pair, but that
  // host is HSTS-preloaded anyway and previews are transient.)
  setResponseHeaders(event, {
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': 'frame-ancestors \'none\'',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()'
  })
})
