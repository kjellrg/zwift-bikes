import type { TerrainCategory } from '../../shared/types/catalog'
import { ROUTE_DISTANCE_MAX_KM, ROUTE_ELEVATION_MAX_M, type RouteCardFilters } from '../utils/routeCardFilters'
import type { useUrlState } from './useUrlState'

/** The terrain chips, in the order the filter bar lists them. */
export const TERRAIN_FILTER_VALUES = ['flat', 'rolling', 'hilly', 'mountainous'] as const satisfies readonly TerrainCategory[]

/**
 * The route filters a Discovery page and the Standings pages share - world,
 * terrain, surface, distance and elevation - as `RouteFilterBar` edits them,
 * and as the page's URL keeps them (`?world=watopia&surface=gravel
 * &terrain=hilly&dist=10-40&elev=0-500`). The homepage adds its search on top.
 *
 * Two values per range: the `pending` one the slider drags against, and the
 * committed one the list and the URL read. The committed value moves once, on
 * `change` (value-commit, i.e. pointer release), the same treatment the
 * homepage's search gets from its debounce: the list and the count settle on
 * what the rider chose rather than reshuffling under every step of a drag
 * (issue #155, when each step was a request).
 *
 * Returned as one reactive object so a page can hand it to `RouteFilterBar`
 * whole and read `filters.active` itself.
 */
export function useRouteFilters() {
  const world = ref<string>('all')
  const surface = ref<'all' | 'gravel' | 'cobble'>('all')
  const terrain = ref<TerrainCategory[]>([])
  const distance = ref<[number, number]>([0, ROUTE_DISTANCE_MAX_KM])
  const elevation = ref<[number, number]>([0, ROUTE_ELEVATION_MAX_M])
  const pendingDistance = ref<[number, number]>([...distance.value])
  const pendingElevation = ref<[number, number]>([...elevation.value])

  // USlider types its payload for both the single and the range shape; only
  // the two-element array is meaningful here, and anything else leaves the
  // drag where it is rather than collapsing the range.
  const asRange = (value: number[] | number | undefined): [number, number] | undefined =>
    Array.isArray(value) && value.length === 2 ? [value[0]!, value[1]!] : undefined

  function toggleTerrain(value: TerrainCategory) {
    terrain.value = terrain.value.includes(value)
      ? terrain.value.filter(entry => entry !== value)
      : [...terrain.value, value]
  }

  /** The committed filters, minus a search: what a list is cut by. */
  const active = computed((): Omit<RouteCardFilters, 'search'> => ({
    world: world.value !== 'all' ? world.value : undefined,
    surface: surface.value !== 'all' ? surface.value : undefined,
    distance: distance.value,
    elevation: elevation.value,
    terrain: terrain.value
  }))

  /** The URL's share of the filters: only what differs from the default, terrain in the chips' own order. */
  const query = computed(() => {
    const [minD, maxD] = distance.value
    const [minE, maxE] = elevation.value
    return {
      world: active.value.world,
      surface: active.value.surface,
      terrain: terrain.value.length ? TERRAIN_FILTER_VALUES.filter(entry => terrain.value.includes(entry)).join(',') : undefined,
      dist: minD > 0 || maxD < ROUTE_DISTANCE_MAX_KM ? `${minD}-${maxD}` : undefined,
      elev: minE > 0 || maxE < ROUTE_ELEVATION_MAX_M ? `${minE}-${maxE}` : undefined
    }
  })

  function reset() {
    world.value = 'all'
    surface.value = 'all'
    terrain.value = []
    distance.value = [0, ROUTE_DISTANCE_MAX_KM]
    elevation.value = [0, ROUTE_ELEVATION_MAX_M]
    pendingDistance.value = [...distance.value]
    pendingElevation.value = [...elevation.value]
  }

  /**
   * Reads the filters back from the URL, once, after mount. Ranges are
   * validated as a pair: a half-range or an inverted one is ignored rather
   * than guessed at.
   */
  function restore({ param, enumParam, slugParam }: Pick<ReturnType<typeof useUrlState>, 'param' | 'enumParam' | 'slugParam'>) {
    const rangeParam = (key: string, max: number): [number, number] | undefined => {
      const match = /^(\d+)-(\d+)$/.exec(param(key) ?? '')
      if (!match) return undefined
      const low = Math.min(max, Number(match[1]))
      const high = Math.min(max, Number(match[2]))
      return low <= high ? [low, high] : undefined
    }
    const worldSlug = slugParam('world')
    if (worldSlug) world.value = worldSlug
    const surfaceValue = enumParam('surface', ['gravel', 'cobble'] as const)
    if (surfaceValue) surface.value = surfaceValue
    const terrainValues = (param('terrain') ?? '').split(',').filter((value): value is TerrainCategory => (TERRAIN_FILTER_VALUES as readonly string[]).includes(value))
    if (terrainValues.length) terrain.value = [...new Set(terrainValues)]
    const dist = rangeParam('dist', ROUTE_DISTANCE_MAX_KM)
    if (dist) {
      distance.value = dist
      pendingDistance.value = [...dist]
    }
    const elev = rangeParam('elev', ROUTE_ELEVATION_MAX_M)
    if (elev) {
      elevation.value = elev
      pendingElevation.value = [...elev]
    }
  }

  return reactive({
    world,
    surface,
    terrain,
    distance,
    elevation,
    pendingDistance,
    pendingElevation,
    active,
    query,
    toggleTerrain,
    setWorld: (value: string) => {
      world.value = value
    },
    setSurface: (value: string) => {
      surface.value = value === 'gravel' || value === 'cobble' ? value : 'all'
    },
    onDistanceInput: (value: number[] | number | undefined) => {
      pendingDistance.value = asRange(value) ?? pendingDistance.value
    },
    onElevationInput: (value: number[] | number | undefined) => {
      pendingElevation.value = asRange(value) ?? pendingElevation.value
    },
    commitDistance: () => {
      distance.value = [...pendingDistance.value]
    },
    commitElevation: () => {
      elevation.value = [...pendingElevation.value]
    },
    reset,
    restore
  })
}

export type RouteFilters = ReturnType<typeof useRouteFilters>
