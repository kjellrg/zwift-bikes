import { getRoutesWithMeta, getWorlds, toRouteSummary } from '../../../shared/utils/catalog'
import type { RouteFilters } from '../../../shared/types/catalog'

export default defineEventHandler((event) => {
  const query = getQuery(event)

  const filters: RouteFilters = {
    search: typeof query.search === 'string' ? query.search.trim().toLowerCase() : undefined,
    world: typeof query.world === 'string' && query.world ? (query.world as RouteFilters['world']) : undefined,
    sport: typeof query.sport === 'string' && query.sport ? (query.sport as RouteFilters['sport']) : undefined,
    minDistance: query.minDistance ? Number(query.minDistance) : undefined,
    maxDistance: query.maxDistance ? Number(query.maxDistance) : undefined,
    minElevation: query.minElevation ? Number(query.minElevation) : undefined,
    maxElevation: query.maxElevation ? Number(query.maxElevation) : undefined,
    surface: typeof query.surface === 'string' && query.surface ? (query.surface as RouteFilters['surface']) : undefined,
    eventOnly: query.eventOnly === 'true' ? true : query.eventOnly === 'false' ? false : undefined
  }

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
