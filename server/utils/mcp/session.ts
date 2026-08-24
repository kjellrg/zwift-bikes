import { randomUUID } from 'node:crypto'
import { RIDER_BOUNDS } from '../../../shared/utils/riderBounds'

/**
 * The rider profile an MCP client sets once per session, so every subsequent
 * `recommend_*` call can be ranked by predicted finish time rather than by the
 * abstract 0-100 `score`. Same three fields - and the same validity bounds,
 * imported as `RIDER_BOUNDS` - the HTTP endpoints validate as query params,
 * so the two can't diverge on what counts as a usable profile (see
 * `server/utils/apiQuerySchemas.ts`).
 */
export interface RiderProfile {
  weightKg: number
  heightCm: number
  /** Sustained power in watts per kilogram - the MCP contract's unit; the recommend endpoints take absolute watts, derived as `weightKg * wkg` in `recommendQuery`. */
  wkg: number
}

interface SessionRecord {
  profile?: RiderProfile
  lastSeenMs: number
}

/**
 * Sessions live in the memory of whichever Workers isolate served the request,
 * and consecutive requests routinely land on different isolates (or different
 * points of presence entirely). This map is therefore a best-effort cache,
 * never an authority: a session id minted by one isolate is simply adopted by
 * the next one that sees it (see `adoptSession`) rather than rejected. Before
 * adoption existed, the unknown-id 404 the MCP spec prescribes fired on nearly
 * every claude.ai request, because its initialize and tools/list consistently
 * hit different isolates - the client just looped on re-initialize.
 *
 * The one thing that can still be lost is a stored rider profile, which is why
 * every profile-dependent tool also accepts `weightKg`/`heightCm`/`wkg`
 * inline: a caller that never wants to depend on server-side state can pass
 * them on each call and ignore `set_rider_profile` entirely.
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

/**
 * Matches the ids `createSession` mints. Adoption is limited to this shape so
 * arbitrary client-chosen strings can't become session keys - anything else
 * still gets the spec's 404.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Accepts a session id minted by another isolate as if it were our own,
 * with no stored profile. Returns `false` for ids we would never have minted.
 */
export function adoptSession(id: string): boolean {
  if (!UUID_PATTERN.test(id)) return false
  const now = Date.now()
  prune(now)
  sessions.set(id, { lastSeenMs: now })
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

  if (!Number.isFinite(weightKg) || weightKg < RIDER_BOUNDS.weightKg.min || weightKg > RIDER_BOUNDS.weightKg.max) {
    return { error: `\`weightKg\` must be the rider's weight in kilograms, between ${RIDER_BOUNDS.weightKg.min} and ${RIDER_BOUNDS.weightKg.max}.` }
  }
  if (!Number.isFinite(heightCm) || heightCm < RIDER_BOUNDS.heightCm.min || heightCm > RIDER_BOUNDS.heightCm.max) {
    return { error: `\`heightCm\` must be the rider's height in centimetres, between ${RIDER_BOUNDS.heightCm.min} and ${RIDER_BOUNDS.heightCm.max}.` }
  }
  if (!Number.isFinite(wkg) || wkg < RIDER_BOUNDS.wkg.min || wkg > RIDER_BOUNDS.wkg.max) {
    return { error: `\`wkg\` must be the rider's sustained power in watts per kilogram (e.g. 3.2, between ${RIDER_BOUNDS.wkg.min} and ${RIDER_BOUNDS.wkg.max}), not absolute watts.` }
  }

  return { profile: { weightKg, heightCm, wkg } }
}
