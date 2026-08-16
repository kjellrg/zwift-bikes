import { getRoutesWithMeta } from '../../../shared/utils/catalog'
import { getAllSegmentSummaries } from '../../../shared/utils/routeSegments'
import { getPublishableRaces, getSeasons } from '../../../shared/utils/events'

export default defineSitemapEventHandler(() => {
  const routeUrls = getRoutesWithMeta().map(route => ({ loc: `/routes/${route.slug}` }))
  const segmentUrls = getAllSegmentSummaries().map(segment => ({ loc: `/segments/${segment.slug}` }))
  const seasonUrls = getSeasons().map(season => ({ loc: `/events/${season.slug}` }))
  // Only races the organiser has actually published details for - an
  // unannounced race has no page to point at (`getPublishableRaces()` is the
  // same gate the prerender list uses, so the two can't drift). `lastmod`
  // comes from the curated entry's own `updatedAt`, never from build time: a
  // build-time date on unchanged content is exactly the kind of inaccuracy
  // that gets lastmod ignored.
  const raceUrls = getPublishableRaces().map(({ race, path }) => ({
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
