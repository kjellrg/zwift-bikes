/**
 * Best-effort rate limiting for the expensive endpoints: `/api/recommend/**`
 * runs a physics simulation per candidate combo, and `/api/mcp` is the
 * unauthenticated public MCP endpoint. Everything else (catalog lookups,
 * pages) is cheap enough not to bother.
 *
 * Per-instance and in-memory, with the same caveat as MCP sessions
 * (`server/utils/mcp/session.ts`): Azure Static Web Apps cold-starts and
 * scales out freely, so the counters reset whenever it does. That's fine -
 * this exists to cap the cost of a single abusive client, not to meter
 * traffic precisely.
 *
 * Requests without `x-forwarded-for` are exempt on purpose: Azure's front
 * end always sets it on external traffic, while Nitro's internal `$fetch`
 * (SSR page renders, the prerender crawl, the MCP tools' in-process API
 * calls - which DO pass through this middleware) and local dev traffic never
 * carry it. One external MCP call therefore costs exactly one token, not one
 * per internal fetch it fans out into.
 */
const buckets = new Map<string, { tokens: number, updatedMs: number }>()

/** Burst allowance per IP - covers a rider fiddling with sliders and paging. */
const CAPACITY = 30
/** Sustained refill: 0.5 tokens/sec = 30 requests/min. */
const REFILL_PER_SEC = 0.5
/**
 * Hard ceiling on tracked IPs so an unauthenticated endpoint can't grow this
 * map without bound. `buckets` is used as an LRU - every hit re-inserts, so
 * the first key is always the least recently seen.
 */
const MAX_BUCKETS = 2000

/**
 * Azure's front end appends `ip:port` entries; IPv6 arrives bracketed
 * (`[::1]:port`) or bare. Only strip a trailing `:port` when it can't be part
 * of the address itself.
 */
function stripPort(value: string): string {
  const bracketed = value.match(/^\[(.+)\]:\d+$/)
  if (bracketed?.[1]) return bracketed[1]
  const colons = value.match(/:/g)?.length ?? 0
  return colons === 1 ? value.replace(/:\d+$/, '') : value
}

export default defineEventHandler((event) => {
  if (import.meta.prerender) return
  // In dev the Nuxt proxy in front of the Nitro worker adds its own
  // `x-forwarded-for: 127.0.0.1` to every request, which would funnel all
  // local traffic into one shared bucket - skip outright instead.
  if (import.meta.dev) return
  const path = event.path.split('?')[0] ?? ''
  if (!path.startsWith('/api/recommend/') && path !== '/api/mcp') return

  const forwarded = getRequestHeader(event, 'x-forwarded-for')
  if (!forwarded) return
  // The LAST entry is the one Azure's own front end appended, which a client
  // can't spoof by sending its own x-forwarded-for value.
  const ip = stripPort((forwarded.split(',').pop() ?? '').trim())
  if (!ip) return

  const now = Date.now()
  const bucket = buckets.get(ip) ?? { tokens: CAPACITY, updatedMs: now }
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + ((now - bucket.updatedMs) / 1000) * REFILL_PER_SEC)
  bucket.updatedMs = now
  // Delete-then-set keeps insertion order equal to recency (LRU).
  buckets.delete(ip)
  buckets.set(ip, bucket)
  if (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next()
    if (!oldest.done) buckets.delete(oldest.value)
  }

  if (bucket.tokens < 1) {
    setResponseHeader(event, 'Retry-After', Math.ceil((1 - bucket.tokens) / REFILL_PER_SEC))
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      message: 'Rate limit exceeded for this endpoint. Try again shortly.'
    })
  }
  bucket.tokens -= 1
})
