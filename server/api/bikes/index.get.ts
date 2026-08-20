import { getFrames } from '../../../shared/utils/catalog'
import { bikesQuerySchema, parseQuery } from '../../utils/apiQuerySchemas'

export default defineEventHandler((event) => {
  const { search, category } = parseQuery(event, bikesQuerySchema)

  const frames = getFrames().filter((frame) => {
    if (search && !frame.name.toLowerCase().includes(search)) return false
    if (category && frame.category !== category) return false
    return true
  })

  return {
    frames: frames.sort((a, b) => a.name.localeCompare(b.name))
  }
})
