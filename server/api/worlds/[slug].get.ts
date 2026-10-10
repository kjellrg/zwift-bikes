import { worldListing, type WorldListing } from '../../utils/worldListing'

/**
 * One world's World page listing (#58): its routes as the homepage's cards
 * and its climbs and sprints as the segments index lists them, read by
 * `app/pages/worlds/[slug].vue`. A plain lookup like the other slug
 * endpoints; a slug that is not one of the game's worlds is a 404, which the
 * page turns into its own.
 */
export default defineEventHandler((event): WorldListing => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing world slug' })
  const listing = worldListing(slug)
  if (!listing) throw createError({ statusCode: 404, statusMessage: `World "${slug}" not found` })
  return listing
})
