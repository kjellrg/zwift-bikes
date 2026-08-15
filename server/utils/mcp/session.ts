import { randomUUID } from 'node:crypto'

/**
 * The rider profile an MCP client sets once per session, so every subsequent
 * `recommend_*` call can be ranked by predicted finish time rather than by the
 * abstract 0-100 `score`. Same three fields - and the same validity bounds -
 * the HTTP endpoints already take as query params, so the two can't diverge on
 * what counts as a usable profile (see `hasRiderProfile` in
 * `server/api/recommend/[slug].get.ts`).
 */
export interface RiderProfile {
  weightKg: number
  heightCm: number
  /** Sustained power in watts per kilogram; absolute watts are derived as `weightKg * wkg`. */
  wkg: number
}

interface SessionRecord {
  profile?: RiderProfile
  lastSeenMs: number
}

/**
 * Sessions live in the memory of whichever instance served the request. On
 * Azure Static Web Apps that's a managed function which cold-starts and scales
 * out freely, so a stored profile is a best-effort convenience, never a
 * guarantee: a request landing on a fresh instance sees an unknown session id
 * and gets a 404, which the MCP spec defines as "re-initialize" - the client
 * starts a new session and the rider profile has to be set again.
 *
 * That's why every profile-dependent tool also accepts `weightKg`/`heightCm`/
 * `wkg` inline: a caller that never wants to depend on server-side state can
 * pass them on each call and ignore `set_rider_profile` entirely.
 */
const sessions = new Map<string, SessionRecord>()

/** Idle timeout. A session not touched within this window is dropped. */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000

/**
 * Hard ceiling on retained sessions, so an unauthenticated public endpoint
 * can't be made to grow this map without bound. `sessions` is used as an LRU -
 * `touch` re-inserts, so the oldest entry is always the least recently used.
 */
const MAX_SESSIONS = 500

function prune(now: number): void {
  for (const [id, record] of sessions) {
    if (now - record.lastSeenMs > SESSION_TTL_MS) sessions.delete(id)
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next()
    if (oldest.done) break
    sessions.delete(oldest.value)
  }
}

export function createSession(): string {
  const now = Date.now()
  prune(now)
  const id = randomUUID()
  sessions.set(id, { lastSeenMs: now })
  return id
}

/**
 * Marks a session as still in use and reports whether it is still known.
 * `false` means the caller should be told to re-initialize (HTTP 404).
 */
export function touchSession(id: string): boolean {
  const now = Date.now()
  const record = sessions.get(id)
  if (!record) return false
  if (now - record.lastSeenMs > SESSION_TTL_MS) {
    sessions.delete(id)
    return false
  }
  record.lastSeenMs = now
  // Re-insert so `sessions` stays ordered least-recently-used first.
  sessions.delete(id)
  sessions.set(id, record)
  return true
}

export function endSession(id: string): void {
  sessions.delete(id)
}

export function getRiderProfile(id: string | undefined): RiderProfile | undefined {
  if (!id) return undefined
  return sessions.get(id)?.profile
}

export function setRiderProfile(id: string, profile: RiderProfile): void {
  const record = sessions.get(id)
  if (record) record.profile = profile
}

/**
 * Validates a caller-supplied profile against exactly the bounds the recommend
 * endpoints use to decide a profile is usable. Rejecting here rather than
 * silently passing an out-of-range value through means the model gets told what
 * is wrong instead of quietly receiving score-ranked results with no times.
 */
export function parseRiderProfile(input: Record<string, unknown>): { profile: RiderProfile } | { error: string } {
  const weightKg = Number(input.weightKg)
  const heightCm = Number(input.heightCm)
  const wkg = Number(input.wkg)

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return { error: '`weightKg` must be the rider\'s weight in kilograms (a positive number).' }
  }
  if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 220) {
    return { error: '`heightCm` must be the rider\'s height in centimetres, between 100 and 220.' }
  }
  if (!Number.isFinite(wkg) || wkg <= 0) {
    return { error: '`wkg` must be the rider\'s sustained power in watts per kilogram (a positive number), not absolute watts.' }
  }

  return { profile: { weightKg, heightCm, wkg } }
}
