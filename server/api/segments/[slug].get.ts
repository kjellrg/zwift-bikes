import { getSegmentSummary, routeWithMetaForSegment } from '../../../shared/utils/routeSegments'

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing segment slug' })
  const segment = getSegmentSummary(slug)
  if (!segment) throw createError({ statusCode: 404, statusMessage: `Segment "${slug}" not found` })
  // The synthetic segment-as-route rides along so the page can render the
  // segment's sliced elevation profile and surface breakdown without waiting
  // on (or duplicating into every cache entry of) the recommend response -
  // this endpoint is query-free, so it's the natural home for page-shell data.
  return { ...segment, route: routeWithMetaForSegment(segment) }
})
