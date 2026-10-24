import { getFrameById } from '../../../shared/utils/catalog'
import type { ClassifiedBikeFrame } from '../../../shared/types/catalog'

/**
 * One frame by its id, as `/api/bikes` lists it: what the Bikes standings'
 * drawer reads when a bike is opened - its upgrade curve and scheme, ratings
 * and whether its wheels are fixed. A plain lookup, so the standings page
 * need not carry it for every row.
 */
export default defineEventHandler((event): ClassifiedBikeFrame => {
  const raw = getRouterParam(event, 'id')
  const id = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined
  if (id === undefined) throw createError({ statusCode: 400, statusMessage: 'Frame id must be a number' })
  const frame = getFrameById(id)
  if (!frame) throw createError({ statusCode: 404, statusMessage: `Frame "${raw}" not found` })
  return frame
})
