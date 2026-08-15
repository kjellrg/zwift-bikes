import type { ComboScore, RouteSummary, SegmentSummary, SurfaceEstimate } from '../../../shared/types/catalog'
import { formatDuration, formatDurationGap } from '../../../shared/utils/duration'

/**
 * The shape the recommend endpoints return. Declared here rather than inferred
 * from Nitro's generated `InternalApi` types so a change to either endpoint's
 * response surfaces as a type error in this file instead of silently reshaping
 * what the model is told.
 */
export interface RecommendPhysics {
  mode: 'dynamic' | 'legacy' | 'compare'
  geometry?: 'measured' | 'known-climbs-compatibility' | 'aggregate-compatibility'
  rider: { weightKg: number, heightCm: number, wkg: number }
  note: string
  /** Present only in TTT draft mode - see `shared/utils/physics/draft.ts`. `riderPowerW` is each rider's own rotation average; the pull/last-wheel figures are what that swings between. */
  ttt?: {
    riders: number
    riderPowerW: number
    frontPullPowerW: number
    lastWheelPowerW: number
    climbWkg?: number
    soloFinishTimeSec?: number
    tttSavedSec?: number
  }
}

export interface RecommendPagination {
  offset: number
  limit: number
  returned: number
  hasMore: boolean
}

export interface RecommendRouteResponse {
  route: RouteSummary
  combos: ComboScore[]
  physics?: RecommendPhysics
  pagination: RecommendPagination
}

export interface RecommendSegmentResponse {
  segment: SegmentSummary
  combos: ComboScore[]
  physics?: RecommendPhysics
  pagination: RecommendPagination
}

/**
 * Gap to the fastest combo on the page, formatted exactly as the rider-facing
 * pages format it - two decimals under a minute. That precision is the point:
 * closely matched combos are routinely separated by hundredths of a second,
 * and rounding them to whole seconds collapses genuinely different combos onto
 * one label, which is what makes a ranking look arbitrary (issue #61).
 */
function formatGap(seconds: number): string {
  return formatDurationGap(seconds, '—')
}

export function formatSurface(surface: SurfaceEstimate): string {
  const parts = [
    surface.road > 0 ? `${Math.round(surface.road)}% road` : undefined,
    surface.gravel > 0 ? `${Math.round(surface.gravel)}% gravel` : undefined,
    surface.cobble > 0 ? `${Math.round(surface.cobble)}% cobbles` : undefined
  ].filter(Boolean)
  return `${parts.join(', ') || 'unknown'} (${surface.confidence})`
}

/**
 * Renders the ranked combos as a markdown table.
 *
 * `confidence` is deliberately a column and not a footnote: it is the
 * difference between a number traceable to a real ZwiftInsider bot test
 * (`measured`) and one derived from a name/style heuristic (`estimated`), and
 * a model relaying a prediction to a rider needs to be able to say which it
 * has. It mirrors the "verified" badge the web UI shows for the same reason.
 */
export function formatComboTable(combos: ComboScore[], startRank: number): string {
  if (combos.length === 0) return '_No bike/wheel combinations matched those filters._'

  const hasTimes = combos.some(combo => combo.finishTimeSec !== undefined)
  const best = hasTimes ? Math.min(...combos.map(c => c.finishTimeSec ?? Infinity)) : 0
  // Only worth a column when this route actually has non-tarmac sections.
  const hasSurfaceCost = combos.some(combo => (combo.surfaceTimePenaltySec ?? 0) > 0)

  const header = ['#', 'Frame', 'Level', 'Wheelset', hasTimes ? 'Time' : 'Score', hasTimes ? 'Gap' : '', hasSurfaceCost ? 'Off-road cost' : '', 'Data'].filter(Boolean)
  const rows = combos.map((combo, index) => {
    // Frames with integrated, non-swappable wheels come back without a
    // wheelset at all - see `hasFixedWheels` in `classifyBikeFrame.ts`.
    const wheelset = combo.wheelset?.name ?? '_fixed wheels_'
    // A combo is only as trustworthy as its weaker half.
    const confidence = combo.wheelset && combo.wheelset.confidence === 'estimated' ? 'estimated' : combo.frame.confidence

    const cells = [
      String(startRank + index),
      combo.frame.name,
      String(combo.frame.level),
      wheelset,
      hasTimes ? formatDuration(combo.finishTimeSec!) : String(combo.score)
    ]
    if (hasTimes) cells.push(formatGap((combo.finishTimeSec ?? 0) - best))
    if (hasSurfaceCost) cells.push(`${Math.round(combo.surfaceTimePenaltySec ?? 0)}s`)
    cells.push(confidence)
    return `| ${cells.join(' | ')} |`
  })

  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows
  ].join('\n')
}

export function formatPagination(pagination: RecommendPagination, total?: number): string {
  const first = pagination.offset + 1
  const last = pagination.offset + pagination.returned
  const suffix = pagination.hasMore
    ? ' More are available - call again with a higher `offset`.'
    : ''
  const of = total === undefined ? '' : ` of ${total}`
  return `Showing ranks ${first}-${last}${of}.${suffix}`
}

/**
 * The one caveat every consumer of a prediction needs, kept to one line so it
 * can be appended to each recommendation without swamping the table.
 */
export const CONFIDENCE_NOTE = '`measured` = frame/wheel performance solved from real ZwiftInsider bot-test data; `estimated` = name/style heuristic, treat as a rough guide.'

/**
 * The TTT assumption line for the recommend tools' headers - present only
 * when the request ran in TTT draft mode. Spells out the rotation-average
 * semantics compactly; the endpoint's own `physics.note` carries the full
 * explanation.
 */
export function formatTttAssumption(physics: RecommendPhysics | undefined): string | undefined {
  const ttt = physics?.ttt
  if (!ttt) return undefined
  const parts = [`- TTT draft mode: ${ttt.riders}-rider paceline; the rider's ${ttt.riderPowerW} W is their own rotation average, swinging between ~${ttt.frontPullPowerW} W on the front and ~${ttt.lastWheelPowerW} W in the last wheel`]
  if (ttt.climbWkg !== undefined) parts.push(`long climbs at ${ttt.climbWkg} W/kg`)
  if (typeof ttt.tttSavedSec === 'number') {
    parts.push(ttt.tttSavedSec >= 0
      ? `saves ~${formatDuration(Math.abs(ttt.tttSavedSec))} vs riding solo`
      : `~${formatDuration(Math.abs(ttt.tttSavedSec))} SLOWER than riding solo`)
  }
  return parts.join('; ')
}
