import { getRoutesWithMeta, getWorlds } from '../../shared/utils/catalog'
import { getAllSegmentSummaries } from '../../shared/utils/routeSegments'
import { getIndexedRaces, getIndexedSeasons } from '../../shared/utils/events'

/** One entry in the sitemap. */
export interface SitemapUrl {
  loc: string
  lastmod?: string
}

/**
 * The sitemap's URLs on `today`, which `server/api/__sitemap__/urls.ts` serves
 * on the day it runs. The sitemap is built with the site (`zeroRuntime`), so
 * that is the build's day, like the prerender list's. Taking the day as an
 * argument is what lets a test hold it.
 */
export function sitemapUrls(today: string): SitemapUrl[] {
  // A World page for each of the game's worlds (#58), from the same list the
  // prerender list reads: the pages that link every route, so a crawler
  // that starts here reaches the routes through them as well as directly.
  const worldUrls = getWorlds().map(world => ({ loc: `/worlds/${world.slug}` }))
  const routeUrls = getRoutesWithMeta().map(route => ({ loc: `/routes/${route.slug}` }))
  const segmentUrls = getAllSegmentSummaries().map(segment => ({ loc: `/segments/${segment.slug}` }))
  // A season only while it has anything left to run, by the same rule as a
  // race below: a run season's page stays up but is noindex.
  // `getIndexedSeasons()` is the list the prerender list reads too.
  const seasonUrls = getIndexedSeasons(today).map(season => ({ loc: `/events/${season.slug}` }))
  // Only races the organiser has actually published details for - an
  // unannounced race has no page to point at - and only while they are still
  // to run: a run race's page stays up but is noindex, and a sitemap that
  // listed it would ask for a crawl of a page that then says not to index it.
  // `getIndexedRaces()` is the same list the prerender list reads, so the two
  // can't drift. `lastmod` comes from the curated entry's own `updatedAt`,
  // never from build time: a build-time date on unchanged content is exactly
  // the kind of inaccuracy that gets lastmod ignored.
  const raceUrls = getIndexedRaces(today).map(({ race, path }) => ({
    loc: path,
    lastmod: race.updatedAt
  }))

  return [
    { loc: '/events' },
    ...seasonUrls,
    ...raceUrls,
    ...worldUrls,
    ...routeUrls,
    ...segmentUrls
  ]
}
