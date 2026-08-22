import { z } from 'zod'

/**
 * Runtime site flags: a tiny ops config read from Workers KV at request time
 * (`server/utils/siteFlags.ts`), so a MOTD banner or a section gate can go
 * live in seconds instead of riding the ~7-minute build. The flags are
 * public by construction - everything in here ships to browsers via
 * `/api/site-flags` - so no secrets, ever. See `docs/site-flags.md`.
 *
 * Named "site flags" rather than "site config" because `useSiteConfig` /
 * `siteConfig` is already taken by nuxt-site-config (see `app.vue`).
 *
 * Two schemas on purpose:
 * - `siteFlagsSchema` (loose) is what the Worker parses KV with. Unknown keys
 *   are ignored so an older deploy keeps working when a newer schema's config
 *   is pushed - rejecting it would silently fail the whole config open and
 *   drop a live MOTD.
 * - `siteFlagsStrictSchema` is what `npm run flags:push` validates the local
 *   file with before writing KV. There a surplus key is a typo (`section` for
 *   `sections`), and catching it at push time is the only chance to - the
 *   runtime's lenient parse would just ignore the misspelled intent.
 */

const motdShape = {
  /**
   * Identifies THIS message for dismissal: dismissing stores the id in
   * localStorage, and only a matching id stays hidden - so publishing a new
   * message (new id) reappears for everyone who dismissed the old one.
   */
  id: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  /** Exactly the Nuxt UI alert colors the banner renders with. */
  tone: z.enum(['info', 'warning', 'error']).default('info'),
  dismissible: z.boolean().default(true),
  /**
   * ISO window the message shows within, either end optional. `startsAt`
   * lets a banner be staged ahead of a scheduled moment (a game update, a
   * season start); `expiresAt` self-removes it - no follow-up push either
   * way. Checked on both sides (server projection and client render)
   * because a cached response can outlive either boundary.
   */
  startsAt: z.iso.datetime({ offset: true }).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  /**
   * Optional destination rendered as the banner's action button -
   * announcements usually want one. Site-relative ("/routes") or absolute.
   */
  href: z.string().min(1).max(500).optional(),
  /** The action button's label; `href` without it falls back to "Read more". */
  linkText: z.string().min(1).max(60).optional()
}

const sectionShape = {
  mode: z.enum(['on', 'hidden']).default('on'),
  /** Shown on a direct visit to a hidden section instead of its content. */
  notice: z.string().max(500).optional()
}

const sectionsShape = {
  events: z.object(sectionShape).prefault({})
}

/**
 * Inline caveats, rendered next to what they qualify rather than site-wide
 * like the MOTD. `recommend` shows above every results list - the softer
 * sibling of the recommend kill switch, for when serving rankings WITH a
 * "being re-verified" warning beats serving none (a Zwift rebalance is a
 * three-position dial: normal, caveated, killed). Not dismissible: a caveat
 * on live numbers stays as long as it applies.
 */
const noticesShape = {
  recommend: z.string().min(1).max(500).optional()
}

/**
 * Server-enforced 503s on the endpoints that cost real money or can serve
 * wrong answers during a data incident. Deliberately NOT part of the public
 * projection: the client has no rendering decision to make from them today,
 * and keeping them server-only leaves room for internal knobs later.
 */
const killSwitchesShape = {
  /** `/api/recommend/**` - e.g. while re-verifying data after a Zwift rebalance. */
  recommend: z.boolean().default(false),
  /** `/api/mcp`. */
  mcp: z.boolean().default(false)
}

const siteFlagsShape = {
  version: z.literal(1).default(1),
  motd: z.object(motdShape).nullable().default(null),
  sections: z.object(sectionsShape).prefault({}),
  notices: z.object(noticesShape).prefault({}),
  killSwitches: z.object(killSwitchesShape).prefault({}),
  /** Stamped by `flags:push`, never authored by hand. */
  updatedAt: z.iso.datetime({ offset: true }).optional()
}

export const siteFlagsSchema = z.object(siteFlagsShape)

export const siteFlagsStrictSchema = z.strictObject({
  ...siteFlagsShape,
  motd: z.strictObject(motdShape).nullable().default(null),
  sections: z.strictObject({
    events: z.strictObject(sectionShape).prefault({})
  }).prefault({}),
  notices: z.strictObject(noticesShape).prefault({}),
  killSwitches: z.strictObject(killSwitchesShape).prefault({})
})

export type SiteFlags = z.output<typeof siteFlagsSchema>
export type SiteMotd = NonNullable<SiteFlags['motd']>

/** What `/api/site-flags` exposes: only what the client renders from. */
export type PublicSiteFlags = Pick<SiteFlags, 'motd' | 'sections' | 'notices'>

export const DEFAULT_SITE_FLAGS: SiteFlags = siteFlagsSchema.parse({})

export const DEFAULT_PUBLIC_SITE_FLAGS: PublicSiteFlags = {
  motd: DEFAULT_SITE_FLAGS.motd,
  sections: DEFAULT_SITE_FLAGS.sections,
  notices: DEFAULT_SITE_FLAGS.notices
}

/**
 * Parses the raw KV value. `null` means "unusable" - the callers fall back to
 * `DEFAULT_SITE_FLAGS` (everything on, no MOTD), because a malformed config
 * must degrade to normal service, never take the site down.
 */
export function parseSiteFlags(raw: string): SiteFlags | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = siteFlagsSchema.safeParse(parsed)
  return result.success ? result.data : null
}

/** Whether `motd` is inside its display window (either bound optional). */
export function isMotdActive(motd: SiteMotd, now: Date = new Date()): boolean {
  if (motd.startsAt !== undefined && now.getTime() < Date.parse(motd.startsAt)) return false
  if (motd.expiresAt !== undefined && now.getTime() >= Date.parse(motd.expiresAt)) return false
  return true
}

/** The client-facing slice of `flags`, with an out-of-window MOTD dropped. */
export function toPublicSiteFlags(flags: SiteFlags, now: Date = new Date()): PublicSiteFlags {
  return {
    motd: flags.motd && isMotdActive(flags.motd, now) ? flags.motd : null,
    sections: flags.sections,
    notices: flags.notices
  }
}
