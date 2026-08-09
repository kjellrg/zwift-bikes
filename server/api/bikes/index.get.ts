import { getFrames } from '../../../shared/utils/catalog'
import type { BikeCategory } from '../../../shared/types/catalog'

export default defineEventHandler((event) => {
  const query = getQuery(event)

  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : undefined
  const category = typeof query.category === 'string' && query.category ? (query.category as BikeCategory) : undefined

  const frames = getFrames().filter((frame) => {
    if (search && !frame.name.toLowerCase().includes(search)) return false
    if (category && frame.category !== category) return false
    return true
  })

  return {
    frames: frames.sort((a, b) => a.name.localeCompare(b.name))
  }
})
