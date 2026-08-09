import { getFrames, getRouteBySlug, toRouteSummary } from '../../../shared/utils/catalog'
import { getWheelsets } from '../../../shared/utils/wheelsets'
import { rankCombos } from '../../../shared/utils/scoring'
import { classifyBikeFrame } from '../../../shared/utils/classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from '../../../shared/utils/finishTime'
import { geometryForRouteLaps, simulateRoute } from '../../../shared/utils/physics'
import { clampLaps } from '../../../shared/utils/routeLaps'
import type { BikeCategory } from '../../../shared/types/catalog'

/** Parses the `owned` query param: a JSON object mapping frame id -> owned upgrade level (0-5).. */
function parseOwnedLevels(raw: unknown): Record<string, number> {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

/** Parses the `ownedWheels` query param: a JSON array of owned `Wheelset.key` strings. */
function parseOwnedWheelKeys(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((key): key is string => typeof key === 'string')
  } catch {
    return []
  }
}

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing route slug' })
  }

  const route = getRouteBySlug(slug)
  if (!route) {
    throw createError({ statusCode: 404, statusMessage: `Route "${slug}" not found` })
  }

  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : undefined
  const category = typeof query.category === 'string' && query.category ? (query.category as BikeCategory) : undefined
  const limit = query.limit ? Math.min(50, Math.max(1, Number(query.limit))) : 8
  const verifiedOnly = query.verifiedOnly === 'true'
  const ownedOnly = query.ownedOnly === 'true'
  const ownedLevels = parseOwnedLevels(query.owned)
  const ownedWheelKeys = parseOwnedWheelKeys(query.ownedWheels)
  const rawDefaultUnownedLevel = Number(query.defaultUnownedLevel)
  const defaultUnownedLevel = Number.isFinite(rawDefaultUnownedLevel)
    ? Math.min(5, Math.max(0, rawDefaultUnownedLevel))
    : 0
  const weightKg = Number(query.weightKg)
  const wkg = Number(query.wkg)
  const hasRiderProfile = Number.isFinite(weightKg) && weightKg > 0 && Number.isFinite(wkg) && wkg > 0
  const laps = clampLaps(route, Number(query.laps))
  // `physics=legacy` is a rollback/diagnostic switch. `dynamic` is the new
  // default when a rider profile is available. `compare` returns both values
  // on each combo while preserving legacy ordering for safe validation.
  const physicsMode = query.physics === 'legacy' || query.physics === 'compare' ? query.physics : 'dynamic'

  let frames = getFrames().filter((frame) => {
    if (category && frame.category !== category) return false
    if (ownedOnly && !(frame.id.toString() in ownedLevels)) return false
    return true
  })

  frames = frames.map((frame) => {
    const ownedLevel = ownedLevels[frame.id.toString()]
    const level = ownedLevel === undefined ? defaultUnownedLevel : ownedLevel
    return level === 0 ? frame : classifyBikeFrame(frame, level)
  })

  let wheelsets = getWheelsets()

  if (verifiedOnly) {
    frames = frames.filter(f => f.confidence === 'measured')
    wheelsets = wheelsets.filter(w => w.confidence === 'measured')
  }

  if (ownedOnly && ownedWheelKeys.length) {
    wheelsets = wheelsets.filter(w => ownedWheelKeys.includes(w.key))
  }

  const rankedCombos = rankCombos(route, frames, wheelsets, frames.length * wheelsets.length)

  if (hasRiderProfile) {
    const geometry = physicsMode === 'legacy' ? undefined : geometryForRouteLaps(route, laps)

    for (const combo of rankedCombos) {
      const legacyFinishTimeSec = estimateFinishTimeSec(route, combo.frame, combo.wheelset, weightKg, wkg, laps)
      combo.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(route, combo.frame, combo.wheelset, weightKg, wkg, laps)

      if (physicsMode === 'legacy' || !geometry) {
        combo.finishTimeSec = legacyFinishTimeSec
      } else {
        const simulation = simulateRoute({
          rider: { weightKg, powerW: weightKg * wkg },
          frame: combo.frame,
          wheelset: combo.wheelset,
          geometry,
          dtSec: 0.25
        })
        combo.finishTimeSec = simulation.elapsedSec
        if (physicsMode === 'compare') {
          ;(combo as typeof combo & { legacyFinishTimeSec?: number }).legacyFinishTimeSec = legacyFinishTimeSec
        }
      }
    }

    if (physicsMode === 'compare') {
      rankedCombos.sort((a, b) => ((a as typeof a & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity) - ((b as typeof b & { legacyFinishTimeSec?: number }).legacyFinishTimeSec ?? Infinity))
    } else {
      rankedCombos.sort((a, b) => (a.finishTimeSec ?? Infinity) - (b.finishTimeSec ?? Infinity))
    }
  }

  const combos = (
    search
      ? rankedCombos.filter(c => c.frame.name.toLowerCase().includes(search) || c.wheelset?.name.toLowerCase().includes(search))
      : rankedCombos
  ).slice(0, limit)

  return {
    route: toRouteSummary(route),
    combos,
    physics: hasRiderProfile ? {
      mode: physicsMode,
      geometry: 'aggregate-compatibility',
      note: 'Dynamic physics is enabled, but route geometry is currently synthesized from aggregate distance/elevation. Replace with measured route geometry for segment-accurate results.'
    } : undefined
  }
})
