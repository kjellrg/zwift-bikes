import { getRoutesWithMeta } from '../../../shared/utils/catalog'
import { getAllSegmentSummaries } from '../../../shared/utils/routeSegments'
import { getIndexedRaces, getSeasons, isoDay } from '../../../shared/utils/events'

export default defineSitemapEventHandler(() => {
  const routeUrls = getRoutesWithMeta().map(route => ({ loc: `/routes/${route.slug}` }))
  const segmentUrls = getAllSegmentSummaries().map(segment => ({ loc: `/segments/${segment.slug}` }))
  const seasonUrls = getSeasons().map(season => ({ loc: `/events/${season.slug}` }))
  // Only races the organiser has actually published details for - an
  // unannounced race has no page to point at - and only while they are still
  // to run: a run race's page stays up but is noindex, and a sitemap that
  // listed it would ask for a crawl of a page that then says not to index it.
  // `getIndexedRaces()` is the same list the prerender list reads, so the two
  // can't drift. The sitemap is built with the site (`zeroRuntime`), so its
  // day is the build's, like the prerender list's. `lastmod` comes from the
  // curated entry's own `updatedAt`, never from build time: a build-time date
  // on unchanged content is exactly the kind of inaccuracy that gets lastmod
  // ignored.
  const raceUrls = getIndexedRaces(isoDay(new Date())).map(({ race, path }) => ({
    loc: path,
    lastmod: race.updatedAt
  }))

  return [
    { loc: '/events' },
    ...seasonUrls,
    ...raceUrls,
    ...routeUrls,
    ...segmentUrls
  ]
})
