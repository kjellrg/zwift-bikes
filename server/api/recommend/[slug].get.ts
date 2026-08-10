import { getFrames, getRouteBySlug, toRouteSummary } from '../../../shared/utils/catalog'
import { getWheelsets } from '../../../shared/utils/wheelsets'
import { capWheelsetsPerFrame, rankCombos } from '../../../shared/utils/scoring'
import { classifyBikeFrame } from '../../../shared/utils/classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from '../../../shared/utils/finishTime'
import { geometryForRouteLaps, simulateRoute } from '../../../shared/utils/physics'
import { clampLaps } from '../../../shared/utils/routeLaps'
import type { BikeCategory } from '../../../shared/types/catalog'

function parseOwnedLevels(raw: unknown): Record<string, number> {
  if (typeof raw !== 'string' || !raw) return {}
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : {} } catch { return {} }
}
function parseOwnedWheelKeys(raw: unknown): Set<string> {
  if (typeof raw !== 'string' || !raw) return new Set()
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? new Set(parsed) : new Set() } catch { return new Set() }
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
  // "Only show my garage items" only makes sense once the rider has actually
  // added something of that kind - with no bikes (or no wheels) in the
  // garage yet, fall back to showing all of them instead of filtering down
  // to zero results.
  const filterFramesByOwnership = ownedOnly && Object.keys(ownedLevels).length > 0
  const filterWheelsetsByOwnership = ownedOnly && ownedWheelKeys.size > 0
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
    if (filterFramesByOwnership && !(frame.id.toString() in ownedLevels)) return false
    return true
  }).map((frame) => {
    const ownedLevel = ownedLevels[frame.id.toString()]
    const level = ownedLevel === undefined ? defaultUnownedLevel : ownedLevel
    return level === 0 ? frame : classifyBikeFrame(frame, level)
  })
  let wheelsets = getWheelsets().filter((wheelset) => {
    if (filterWheelsetsByOwnership && !ownedWheelKeys.has(wheelset.key)) return false
    return true
  })
  if (verifiedOnly) {
    frames = frames.filter(f => f.confidence === 'measured')
    wheelsets = wheelsets.filter(w => w.confidence === 'measured')
  }

  // `rankCombos` scores every frame x wheelset pair internally regardless of
  // the `limit` passed in - it only truncates the *returned* array at the
  // end - so there's no computational reason to restrict it up front. Always
  // fetch the full candidate pool so both the search filter below and the
  // ranking step that follows see every candidate, not an arbitrary slice.
  const rankedCombos = rankCombos(route, frames, wheelsets, frames.length * wheelsets.length)

  // Once we know the rider's weight/power, `estimateFinishTimeSec` (cheap -
  // a ~40-iteration bisection, no per-meter simulation) is a far more
  // faithful ranking signal than `rankCombos`'s abstract 0-100 `score`.
  // `score` deliberately zeroes out aero/climb credit in proportion to a
  // route's off-road percentage, modeling the real Zwift fact that rolling
  // resistance on cobbles/gravel is purely a wheel-Crr-class effect (see
  // `scoring.ts`'s `OFFROAD_FRAME_WEIGHT` comment). But `estimateFinishTimeSec`
  // correctly keeps rewarding a low-CdA/light combo's aero and climb
  // advantage on those same routes, since aero drag and gravity don't stop
  // applying just because the surface is rough - Crr is an ADDITIONAL
  // resistance term, not a replacement for them. That mismatch let a combo
  // that's genuinely faster (by the same physics `estimateFinishTimeSec`
  // itself uses) rank outside `score`'s idea of "the best candidates" and
  // never get a finish time computed at all - hiding it from both the
  // results list and `search`, e.g. an aero/climb-strong road frame losing
  // to a merely score-tied one on a heavily cobbled route. Re-ranking the
  // FULL pool by the cheap estimate up front - before search/pagination -
  // fixes that at the source instead of only patching what a page happens
  // to already contain.
  let orderedCombos = rankedCombos
  if (hasRiderProfile) {
    orderedCombos = rankedCombos
      .map(combo => ({ ...combo, finishTimeSec: estimateFinishTimeSec(route, combo.frame, combo.wheelset, weightKg, heightCm, wkg, laps) }))
      .sort((a, b) => a.finishTimeSec - b.finishTimeSec)
  }

  // `capWheelsetsPerFrame` must never run before `search` gets to look at
  // the full pool - see its doc comment - so it's skipped entirely while
  // searching, in favor of showing every real match.
  const filteredRankedCombos = search
    ? orderedCombos.filter(c => c.frame.name.toLowerCase().includes(search) || c.wheelset?.name.toLowerCase().includes(search))
    : capWheelsetsPerFrame(orderedCombos, hasRiderProfile ? c => c.finishTimeSec! : c => c.score)
  const pageCombos = filteredRankedCombos.slice(offset, offset + limit)

  if (hasRiderProfile) {
    const geometry = physicsMode === 'legacy' ? undefined : geometryForRouteLaps(route, laps)
    for (const combo of pageCombos) {
      // Already computed in the full-pool ranking pass above - reuse it
      // instead of recalculating the same closed-form estimate twice.
      const legacyFinishTimeSec = combo.finishTimeSec!
      combo.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(route, combo.frame, combo.wheelset, weightKg, heightCm, wkg, laps)
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
    physics: hasRiderProfile
      ? {
          mode: physicsMode,
          geometry: route.terrain.elevationProfile
            ? 'measured'
            : route.terrain.climbs.length > 0 ? 'known-climbs-compatibility' : 'aggregate-compatibility',
          rider: { weightKg, heightCm, wkg },
          note: route.terrain.elevationProfile
            ? 'Dynamic physics is active. Rider height affects aerodynamic drag; this route’s elevation profile is real, measured GPS data (not synthesized), so grade changes are modeled at their actual position along the route.'
            : route.terrain.climbs.length > 0
              ? 'Dynamic physics is active. Rider height affects aerodynamic drag; this route’s named climb(s) use real length/gradient data, with the remaining unmapped distance still synthesized from aggregate elevation.'
              : 'Dynamic physics is active. Rider height affects aerodynamic drag; route geometry is currently synthesized from aggregate distance/elevation - no named climbs are mapped for this route.'
        }
      : undefined,
    pagination: {
      offset,
      limit,
      returned: pageCombos.length,
      hasMore: filteredRankedCombos.length > offset + pageCombos.length
    }
  }
})
