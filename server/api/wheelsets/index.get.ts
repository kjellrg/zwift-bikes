import { getWheelsets } from '../../../shared/utils/wheelsets'
import { parseQuery, wheelsetsQuerySchema } from '../../utils/apiQuerySchemas'

export default defineEventHandler((event) => {
  const { search } = parseQuery(event, wheelsetsQuerySchema)

  const wheelsets = getWheelsets().filter((wheelset) => {
    if (search && !wheelset.name.toLowerCase().includes(search)) return false
    return true
  })

  return { wheelsets: wheelsets.sort((a, b) => a.name.localeCompare(b.name)) }
})
