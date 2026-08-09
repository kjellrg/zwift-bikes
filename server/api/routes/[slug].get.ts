import { getRouteBySlug } from '../../../shared/utils/catalog'

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing route slug' })
  }

  const route = getRouteBySlug(slug)
  if (!route) {
    throw createError({ statusCode: 404, statusMessage: `Route "${slug}" not found` })
  }

  return route
})
