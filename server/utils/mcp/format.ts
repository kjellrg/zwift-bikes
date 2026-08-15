import type { ComboScore, RouteSummary, SegmentSummary, SurfaceEstimate } from '../../../shared/types/catalog'

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

/** `h:mm:ss` past an hour, `m:ss` below it. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const paddedSecs = String(secs).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSecs}`
  return `${minutes}:${paddedSecs}`
}

/**
 * Gap to the fastest combo on the page. Sub-minute gaps read better in plain
 * seconds, and a gap that rounds to zero is shown as `+<1s` rather than `—`:
 * combos routinely land within a fraction of a second of each other, and a
 * column of `—` would read as several joint-fastest bikes instead of one
 * winner and some near-ties.
 */
function formatGap(seconds: number): string {
  if (seconds <= 0) return '—'
  const rounded = Math.round(seconds)
  if (rounded === 0) return '+<1s'
  return rounded < 60 ? `+${rounded}s` : `+${formatDuration(rounded)}`
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

  const header = ['#', 'Frame', 'Wheelset', hasTimes ? 'Time' : 'Score', hasTimes ? 'Gap' : '', hasSurfaceCost ? 'Off-road cost' : '', 'Data'].filter(Boolean)
  const rows = combos.map((combo, index) => {
    const level = combo.frame.level > 0 ? ` (lvl ${combo.frame.level})` : ''
    // Frames with integrated, non-swappable wheels come back without a
    // wheelset at all - see `hasFixedWheels` in `classifyBikeFrame.ts`.
    const wheelset = combo.wheelset?.name ?? '_fixed wheels_'
    // A combo is only as trustworthy as its weaker half.
    const confidence = combo.wheelset && combo.wheelset.confidence === 'estimated' ? 'estimated' : combo.frame.confidence

    const cells = [
      String(startRank + index),
      `${combo.frame.name}${level}`,
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
