import type { SegmentSummary } from '../../shared/types/catalog'

/**
 * The climb wedges on the segments index: a right triangle per climb, all the
 * same width, whose height is its average grade on one scale for the whole
 * page, so two climbs are told apart by how steep they are and the length
 * stays in the muted line beside them. A width that followed length made a
 * short climb a sliver next to a long one (issue #300 review). The scale is
 * the steepest average grade listed, computed from the catalog served and
 * never hard-coded.
 */
export interface WedgeScale {
  maxGradePercent: number
}

/** A segment's grade as every display surface reads it: the measured one when there is one (see `SegmentSummary`). */
export function segmentGrade(segment: Pick<SegmentSummary, 'avgGradePercent' | 'measuredAvgGradePercent'>): number {
  return segment.measuredAvgGradePercent ?? segment.avgGradePercent
}

export function wedgeScale(climbs: Pick<SegmentSummary, 'avgGradePercent' | 'measuredAvgGradePercent'>[]): WedgeScale {
  return { maxGradePercent: Math.max(0, ...climbs.map(climb => segmentGrade(climb))) }
}

/** One climb's wedge height as a share (0..1) of the scale's. A flat or unmeasured climb has none. */
export function wedgeHeight(climb: Pick<SegmentSummary, 'avgGradePercent' | 'measuredAvgGradePercent'>, scale: WedgeScale): number {
  return scale.maxGradePercent > 0 ? Math.min(1, Math.max(0, segmentGrade(climb)) / scale.maxGradePercent) : 0
}
