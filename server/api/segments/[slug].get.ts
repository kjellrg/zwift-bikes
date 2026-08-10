import { getSegmentSummary } from '../../../shared/utils/routeSegments'

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing segment slug' })
  const segment = getSegmentSummary(slug)
  if (!segment) throw createError({ statusCode: 404, statusMessage: `Segment "${slug}" not found` })
  return segment
})
