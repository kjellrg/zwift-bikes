/**
 * The absolute URL of the current page, built from the configured site URL
 * and the route path alone - never from the incoming request.
 *
 * Building it from the path collapses every query-string variant of a page
 * onto the one URL we want indexed. This mattered most for /segments/[slug]
 * historically: RouteClimbs/RouteSprints used to link each segment as
 * `?route=<slug>` once per route it appeared on (removed since - hosts never
 * meaningfully disagreed about a segment's surface), so a segment like Alpe
 * du Zwift was reachable at dozens of near-identical URLs that would
 * otherwise compete with each other (and with the clean URL) in search
 * results - and crawlers may keep requesting those old URLs indefinitely.
 *
 * Ignoring the request host is what keeps the URL correct off the dev
 * machine. `useRequestURL()` reports whichever host served the render, and
 * the host we actually render on isn't the public one: prerendered pages
 * (all of /routes/** and /events/**) are built against `localhost`, and
 * SSR'd pages saw the old Azure SWA deployment's internal
 * `*.azurewebsites.net` origin rather than zwiftbikes.com (the same class of
 * mismatch applies on Cloudflare). Both leaked into BreadcrumbList
 * `item` URLs and a SportsEvent `url` until this replaced them - Search
 * Console reported the markup as valid either way, because it validates the
 * shape and not the domain, but an off-site `item` URL can't tie the trail
 * back to this site, so the breadcrumb never earns its rich result.
 *
 * Used for the canonical tag and og:url in app.vue, and by every page that
 * puts its own URL into JSON-LD.
 */
export function useCanonicalUrl() {
  const siteConfig = useSiteConfig()
  const route = useRoute()
  return computed(() => {
    const path = route.path.replace(/\/+$/, '')
    return `${siteConfig.url.replace(/\/+$/, '')}${path || '/'}`
  })
}
