import { getFrames, getRouteBySlug, toRouteSummary } from '../../../shared/utils/catalog'
import { getWheelsets } from '../../../shared/utils/wheelsets'
import { rankCombos } from '../../../shared/utils/scoring'
import { classifyBikeFrame } from '../../../shared/utils/classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from '../../../shared/utils/finishTime'
import { clampLaps } from '../../../shared/utils/routeLaps'
import type { BikeCategory } from '../../../shared/types/catalog'

/** Parses the `owned` query param: a JSON object mapping frame id -> owned upgrade level (0-5). */
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

  let frames = getFrames().filter((frame) => {
    if (category && frame.category !== category) return false
    if (ownedOnly && !(frame.id.toString() in ownedLevels)) return false
    return true
  })

  // Reclassify owned frames at the rider's actual upgrade level, and
  // non-owned frames at the rider's assumed default upgrade level, instead
  // of the cached Stage-0 default.
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

  // Only filter wheelsets by ownership when the rider has actually marked
  // wheels as owned in their garage - if they've only set up owned bikes so
  // far, "my bikes only" should keep behaving as it did before wheel
  // ownership existed (all wheelsets available).
  if (ownedOnly && ownedWheelKeys.length) {
    wheelsets = wheelsets.filter(w => ownedWheelKeys.includes(w.key))
  }

  // `search` matches either the frame OR the wheelset name (a rider might be
  // looking for a specific wheel, not just a bike) - so it can't be applied
  // as a pre-filter on `frames`/`wheelsets` independently (that would only
  // keep combos where BOTH sides happen to match). Instead rank the full
  // cross product first, then filter the sorted combos by search, then
  // apply `limit`.
  const rankedCombos = rankCombos(route, frames, wheelsets, frames.length * wheelsets.length)

  // When we know the rider's weight/W-per-kg, compute a real physics-based
  // finish time per combo and re-sort by that instead of the heuristic
  // `score` - `score` is a "how well suited is this equipment to this
  // route" rating (aero/climb/gravel/cobble blend) and doesn't always agree
  // with actual pace (see `scoring.ts`'s `TT_DISC_SCORE_BONUS` comment), so
  // sorting by estimated time is the more literal "fastest first" ordering.
  if (hasRiderProfile) {
    for (const combo of rankedCombos) {
      combo.finishTimeSec = estimateFinishTimeSec(route, combo.frame, combo.wheelset, weightKg, wkg, laps)
      combo.surfaceTimePenaltySec = estimateSurfaceTimePenaltySec(route, combo.frame, combo.wheelset, weightKg, wkg, laps)
    }
    rankedCombos.sort((a, b) => (a.finishTimeSec ?? Infinity) - (b.finishTimeSec ?? Infinity))
  }

  const combos = (
    search
      ? rankedCombos.filter(c => c.frame.name.toLowerCase().includes(search) || c.wheelset?.name.toLowerCase().includes(search))
      : rankedCombos
  ).slice(0, limit)

  return {
    route: toRouteSummary(route),
    combos
  }
})
