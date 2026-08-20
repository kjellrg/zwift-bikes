import { getRoutesWithMeta, getWorlds, toRouteSummary } from '../../../shared/utils/catalog'
import type { RouteFilters } from '../../../shared/types/catalog'
import { parseQuery, routesQuerySchema } from '../../utils/apiQuerySchemas'

export default defineEventHandler((event) => {
  const filters: RouteFilters = parseQuery(event, routesQuerySchema)

  const routes = getRoutesWithMeta().filter((route) => {
    if (filters.search && !route.name.toLowerCase().includes(filters.search)) return false
    if (filters.world && route.world !== filters.world) return false
    if (filters.sport && !route.sports.includes(filters.sport)) return false
    if (filters.minDistance !== undefined && route.distance < filters.minDistance) return false
    if (filters.maxDistance !== undefined && route.distance > filters.maxDistance) return false
    if (filters.minElevation !== undefined && route.elevation < filters.minElevation) return false
    if (filters.maxElevation !== undefined && route.elevation > filters.maxElevation) return false
    if (filters.surface === 'gravel' && route.surface.gravel <= 0) return false
    if (filters.surface === 'cobble' && route.surface.cobble <= 0) return false
    if (filters.eventOnly !== undefined && route.eventOnly !== filters.eventOnly) return false
    return true
  })

  return {
    routes: routes.map(toRouteSummary).sort((a, b) => a.name.localeCompare(b.name)),
    worlds: getWorlds()
  }
})
