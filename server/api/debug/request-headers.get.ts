/**
 * TEMPORARY - diagnostic for PR #116's rate-limit keying, to be REMOVED
 * before merge. The live-Azure test showed two devices on different networks
 * sharing one rate-limit bucket, meaning the last `x-forwarded-for` entry is
 * a shared infrastructure hop rather than the client. This echoes the
 * forwarding-related headers a request actually arrives with, plus the key
 * the rate limiter would derive from them, so the keying can be fixed
 * against real data instead of another assumption. Only reflects the
 * caller's own request metadata - no server state.
 */

// Mirrors stripPort in server/middleware/rate-limit.ts (temporary copy).
function stripPort(value: string): string {
  const bracketed = value.match(/^\[(.+)\]:\d+$/)
  if (bracketed?.[1]) return bracketed[1]
  const colons = value.match(/:/g)?.length ?? 0
  return colons === 1 ? value.replace(/:\d+$/, '') : value
}

export default defineEventHandler((event) => {
  const headers = getRequestHeaders(event)
  const interesting = Object.fromEntries(
    Object.entries(headers).filter(([name]) => /forward|client|real[-_]?ip|azure|^x-ms-|^via$|^host$/i.test(name))
  )
  const forwarded = headers['x-forwarded-for']
  const entries = forwarded ? forwarded.split(',').map(entry => stripPort(entry.trim())).filter(Boolean) : []
  return {
    interesting,
    xffEntries: entries,
    // Mirrors the fixed keying in rate-limit.ts: the entry before Azure's
    // own appended hop, i.e. the address the SWA edge accepted the
    // connection from.
    limiterKey: (entries.length >= 2 ? entries[entries.length - 2] : entries[0]) ?? null
  }
})
