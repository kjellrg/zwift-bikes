import { getRoutesWithMeta } from '../../../shared/utils/catalog'
import { getAllSegmentSummaries } from '../../../shared/utils/routeSegments'

export default defineSitemapEventHandler(() => {
  const routeUrls = getRoutesWithMeta().map(route => ({ loc: `/routes/${route.slug}` }))
  const segmentUrls = getAllSegmentSummaries().map(segment => ({ loc: `/segments/${segment.slug}` }))

  return [...routeUrls, ...segmentUrls]
})
