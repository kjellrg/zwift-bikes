import type { H3Event } from 'h3'
import type { SiteFlags } from '../../shared/utils/siteFlags'
import { DEFAULT_SITE_FLAGS, parseSiteFlags } from '../../shared/utils/siteFlags'

/**
 * Reads the runtime site flags from Workers KV (`SITE_FLAGS` in
 * wrangler.jsonc, key `site-flags`, written by `npm run flags:push`).
 *
 * Fail-open by design: no binding (nuxt dev, the prerender crawl, vitest),
 * no key yet, unparseable JSON or a schema-invalid value all resolve to
 * `DEFAULT_SITE_FLAGS` - everything on, no MOTD. A broken or missing config
 * must degrade to normal service, never take the site down, which also means
 * a brand-new environment needs zero KV setup to work.
 */

/**
 * The one KV method this feature uses - hand-declared instead of pulling in
 * `@cloudflare/workers-types`, for the same reason `rate-limit.ts` declares
 * its binding locally: that package's ambient globals would fight the Node
 * types everywhere else.
 */
interface SiteFlagsKvBinding {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>
}

const KV_KEY = 'site-flags'

/**
 * Both TTLs say the same thing - a flags change may take up to a minute to be
 * visible, which docs/site-flags.md documents as the contract. `cacheTtl` (60
 * is KV's minimum) serves repeat reads from the colo's edge cache; the
 * module-scope memo on top spares even that lookup within a warm isolate.
 * The memo is shared config, not request state, so caching it across
 * requests is exactly right - and worst-case staleness stays ~60s because a
 * fresh isolate starts empty.
 */
const MEMO_TTL_MS = 60_000
let memo: { flags: SiteFlags, fetchedAt: number } | undefined

export async function getSiteFlags(event: H3Event): Promise<SiteFlags> {
  const kv = (event.context.cloudflare as { env?: { SITE_FLAGS?: SiteFlagsKvBinding } } | undefined)?.env?.SITE_FLAGS
  if (!kv) return DEFAULT_SITE_FLAGS

  const now = Date.now()
  if (memo && now - memo.fetchedAt < MEMO_TTL_MS) return memo.flags

  try {
    const raw = await kv.get(KV_KEY, { cacheTtl: 60 })
    const flags = (raw === null ? null : parseSiteFlags(raw)) ?? DEFAULT_SITE_FLAGS
    memo = { flags, fetchedAt: now }
    return flags
  } catch {
    // A transient KV error isn't memoized: the next request retries rather
    // than pinning defaults for a minute.
    return DEFAULT_SITE_FLAGS
  }
}
