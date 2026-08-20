import { getAllSegmentSummaries } from '../../../shared/utils/routeSegments'
import { getWorlds } from '../../../shared/utils/catalog'
import { parseQuery, segmentsQuerySchema } from '../../utils/apiQuerySchemas'

export default defineEventHandler((event) => {
  const { search, world } = parseQuery(event, segmentsQuerySchema)

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
