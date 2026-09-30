import type { SegmentSummary } from '../../shared/types/catalog'

/**
 * The climb wedges on the segments index: a right triangle per climb whose
 * height is its average grade, linear on one scale for the whole page, and
 * whose width is its length on the same scale under a square root. A linear
 * width made a 0.9 km climb a sliver beside a 19 km one (issue #300 review),
 * so the root keeps a short climb readable while a long one is still plainly
 * longer; it also means a wedge's area is no longer the climbing it holds,
 * which the muted line beside it says in numbers. The scale is the longest
 * climb and the steepest average grade listed; it is computed from the
 * catalog served, never hard-coded.
 */
export interface WedgeScale {
  maxLengthKm: number
  maxGradePercent: number
}

/** A segment's grade as every display surface reads it: the measured one when there is one (see `SegmentSummary`). */
export function segmentGrade(segment: Pick<SegmentSummary, 'avgGradePercent' | 'measuredAvgGradePercent'>): number {
  return segment.measuredAvgGradePercent ?? segment.avgGradePercent
}

export function wedgeScale(climbs: Pick<SegmentSummary, 'lengthKm' | 'avgGradePercent' | 'measuredAvgGradePercent'>[]): WedgeScale {
  return {
    maxLengthKm: Math.max(0, ...climbs.map(climb => climb.lengthKm)),
    maxGradePercent: Math.max(0, ...climbs.map(climb => segmentGrade(climb)))
  }
}

/** The narrowest a wedge is drawn, as a share of the scale's width, so the shortest climb is still a shape. */
export const MIN_WEDGE_WIDTH = 0.12

/** One climb's wedge as shares (0..1) of the scale's width and height. A flat or unmeasured climb has no height. */
export function wedgeShape(
  climb: Pick<SegmentSummary, 'lengthKm' | 'avgGradePercent' | 'measuredAvgGradePercent'>,
  scale: WedgeScale
): { width: number, height: number } {
  return {
    width: scale.maxLengthKm > 0 ? Math.min(1, Math.max(MIN_WEDGE_WIDTH, Math.sqrt(climb.lengthKm / scale.maxLengthKm))) : 0,
    height: scale.maxGradePercent > 0 ? Math.min(1, Math.max(0, segmentGrade(climb)) / scale.maxGradePercent) : 0
  }
}
