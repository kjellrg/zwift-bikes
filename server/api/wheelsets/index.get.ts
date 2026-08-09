import { getWheelsets } from '../../../shared/utils/wheelsets'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : undefined

  const wheelsets = getWheelsets().filter((wheelset) => {
    if (search && !wheelset.name.toLowerCase().includes(search)) return false
    return true
  })

  return { wheelsets: wheelsets.sort((a, b) => a.name.localeCompare(b.name)) }
})
