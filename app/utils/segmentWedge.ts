import type { SegmentSummary } from '../../shared/types/catalog'

/**
 * The climb wedges on the segments index: a right triangle per climb whose
 * width is its length and whose height is its average grade, both linear and
 * on one scale for the whole page, so a wedge's area is proportional to the
 * climbing it holds and two climbs can be told apart by eye across worlds.
 * The scale is the longest climb and the steepest average grade listed; it is
 * computed from the catalog served, never hard-coded.
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

/** One climb's wedge as shares (0..1) of the scale's width and height. A flat or unmeasured climb has no height. */
export function wedgeShape(
  climb: Pick<SegmentSummary, 'lengthKm' | 'avgGradePercent' | 'measuredAvgGradePercent'>,
  scale: WedgeScale
): { width: number, height: number } {
  return {
    width: scale.maxLengthKm > 0 ? Math.min(1, climb.lengthKm / scale.maxLengthKm) : 0,
    height: scale.maxGradePercent > 0 ? Math.min(1, Math.max(0, segmentGrade(climb)) / scale.maxGradePercent) : 0
  }
}
