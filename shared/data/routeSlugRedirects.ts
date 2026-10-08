/**
 * Old route slug -> the slug the same route has now.
 *
 * A route page lives at `/routes/<slug>`, and the slug is whatever
 * `route.slug` zwift-data exposes - which can change. Four Makuri Madness
 * routes were published under bare numeric ids (their route ids) from
 * August 2026, were linked from every ZRacing and ZRL race page that used
 * them, and got readable slugs in zwift-data 2.1 (2026-10-07). The old URLs
 * had been live for two months, so they redirect rather than 404.
 *
 * `routeSlugRedirectRules()` turns this table into Nitro `routeRules` for
 * `nuxt.config.ts`; the redirect runs in the Worker, since no old path is
 * prerendered. Delete an entry once nothing can still link to the old slug.
 * The test beside this file checks every target still resolves and that no
 * old slug has come back as a live one.
 */
export const ROUTE_SLUG_REDIRECTS: Readonly<Record<string, string>> = {
  2919739330: 'mech-isle-mayhem',
  4092230492: 'urumaze',
  362278484: 'twilight-crit',
  811898717: 'what-yumezi-were-lost'
}

/** One permanent redirect per retired slug, keyed by the old page path. */
export function routeSlugRedirectRules(): Record<string, { redirect: { to: string, statusCode: 301 } }> {
  return Object.fromEntries(
    Object.entries(ROUTE_SLUG_REDIRECTS).map(([from, to]) => [`/routes/${from}`, { redirect: { to: `/routes/${to}`, statusCode: 301 as const } }])
  )
}
