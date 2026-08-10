import { getAllSegmentSummaries } from '../../../shared/utils/routeSegments'
import { getWorlds } from '../../../shared/utils/catalog'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : undefined
  const world = typeof query.world === 'string' && query.world ? query.world : undefined

  const segmentList = getAllSegmentSummaries().filter((segment) => {
    if (search && !segment.name.toLowerCase().includes(search)) return false
    if (world && segment.world !== world) return false
    return true
  })

  return {
    segments: segmentList,
    worlds: getWorlds()
  }
})
