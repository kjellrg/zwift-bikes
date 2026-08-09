import { getFrames, getRouteBySlug, toRouteSummary } from '../../../shared/utils/catalog'
import { getWheelsets } from '../../../shared/utils/wheelsets'
import { rankCombos } from '../../../shared/utils/scoring'
import { classifyBikeFrame } from '../../../shared/utils/classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from '../../../shared/utils/finishTime'
import { geometryForRouteLaps, simulateRoute } from '../../../shared/utils/physics'
import { clampLaps } from '../../../shared/utils/routeLaps'
import type { BikeCategory } from '../../../shared/types/catalog'

function parseOwnedLevels(raw: unknown): Record<string, number> {
  if (typeof raw !== 'string' || !raw) return {}
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : {} } catch { return {} }
}
function parseOwnedWheelKeys(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [] } catch { return [] }
}

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing route slug' })
  const route = getRouteBySlug(slug)
  if (!route) throw createError({ statusCode: 404, statusMessage: `Route "${slug}" not found` })

  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : undefined
  const category = typeof query.category === 'string' && query.category ? (query.category as BikeCategory) : undefined
  const limit = query.limit ? Math.min(9, Math.max(1, Number(query.limit))) : 9
  const offset = query.offset ? Math.max(0, Math.floor(Number(query.offset))) : 0
  const verifiedOnly = query.verifiedOnly === 'true'
  const ownedOnly = query.ownedOnly === 'true'
  const ownedLevels = parseOwnedLevels(query.owned)
  const ownedWheelKeys = parseOwnedWheelKeys(query.ownedWheels)
  const rawDefaultUnownedLevel = Number(query.defaultUnownedLevel)
  const defaultUnownedLevel = Number.isFinite(rawDefaultUnownedLevel) ? Math.min(5, Math.max(0, rawDefaultUnownedLevel)) : 0
  const weightKg = Number(query.weightKg)
  const heightCm = Number(query.heightCm)
  const wkg = Number(query.wkg)
  const hasRiderProfile = Number.isFinite(weightKg) && weightKg > 0 && Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 220 && Number.isFinite(wkg) && wkg > 0
  const laps = clampLaps(route, Number(query.laps))
  const physicsMode = query.physics === 'legacy' || query.physics === 'compare' ? query.physics : 'dynamic'

  let frames = getFrames().filter((frame) => {
    if (category && frame.category !== category) return false
    if (ownedOnly && !(frame.id.toString() in ownedLevels)) return false
    return true
  }).map((frame) => {
    const ownedLevel = ownedLevels[frame.id.toString()]
    const level = ownedLevel === undefined ? defaultUnownedLevel : ownedLevel
    return level === 0 ? frame : classifyBikeFrame(frame, level)
  })
  let wheelsets = getWheelsets()
  if (verifiedOnly) {
    frames = frames.filter(f => f.confidence === 'measured')
    wheelsets = wheelsets.filter(w => w.confidence === 'measured')
  }
  if (ownedOnly && ownedWheelKeys.length) wheelsets = wheelsets.filter(w => ownedWheelKeys.includes(w.key))

  // Score/rank all combinations cheaply, but only run the expensive physics
  // model for the requested page. This keeps the initial route response fast
  // while allowing the UI to fetch the next 9 explicitly when requested.
  const rankedCombos = rankCombos(route, frames, wheelsets, offset + limit)
  const filteredRankedCombos = search
    ? rankedCombos.filter(c => c.frame.name.toLowerCase().includes(search) || c.wheelset?.name.toLowerCase().includes(search))
    : rankedCombos
  const pageCombos = filteredRankedCombos.slice(offset, offset + limit)

  if (hasRiderProfile) {
    const geometry = physicsMode === 'legacy' ? undefined : geometryForRouteLaps(route, laps)
    for (const combo of pageCombos) {
      const legacyFinishTimeSec = estimateFinishTimeSec(route, combo.frame, combo.wheelset, weightKg, wkg, laps)
      combo.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(route, combo.frame, combo.wheelset, weightKg, wkg, laps)
      if (physicsMode === 'legacy' || !geometry) {
        combo.finishTimeSec = legacyFinishTimeSec
      } else {
        const simulation = simulateRoute({
          rider: { weightKg, heightCm, powerW: weightKg * wkg },
          frame: combo.frame,
          wheelset: combo.wheelset,
          geometry,
          dtSec: 0.25
        })
        combo.finishTimeSec = simulation.elapsedSec
        if (physicsMode === 'compare') (combo as typeof combo & { legacyFinishTimeSec?: number }).legacyFinishTimeSec = legacyFinishTimeSec
      }
    }
    if (physicsMode === 'compare') pageCombos.sort((a, b) => ((a as typeof a & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity) - ((b as typeof b & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity))
    else pageCombos.sort((a, b) => (a.finishTimeSec ?? Infinity) - (b.finishTimeSec ?? Infinity))
  }

  return {
    route: toRouteSummary(route),
    combos: pageCombos,
    physics: hasRiderProfile ? {
      mode: physicsMode,
      geometry: 'aggregate-compatibility',
      rider: { weightKg, heightCm, wkg },
      note: 'Dynamic physics is active. Rider height affects aerodynamic drag; route geometry is currently synthesized from aggregate distance/elevation and will be replaced with measured route geometry.'
    } : undefined,
    pagination: {
      offset,
      limit,
      returned: pageCombos.length,
      hasMore: filteredRankedCombos.length > offset + pageCombos.length
    }
  }
})
