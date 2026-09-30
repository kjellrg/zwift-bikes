import type { SegmentSummary } from '../../shared/types/catalog'

/**
 * The climb drawings on the segments index: each climb's own profile, every
 * one the same width, on one vertical scale for the whole page. A point's
 * height is its rise over the climb's length, so a drawing is as tall as the
 * climb is steep and two climbs are told apart by both how steep and how
 * lumpy they are; the length itself stays in the muted line beside them. A
 * width that followed length made a short climb a sliver next to a long one
 * (issue #300 review). A climb with no measured profile is drawn as a straight
 * ramp at its average grade, which is all that is known of it. The scale is
 * the steepest point listed, computed from the catalog served and never
 * hard-coded.
 */
export interface WedgeScale {
  /** The largest rise-over-length any listed climb reaches, as a fraction (0.136 is 13.6%). */
  maxRise: number
}

type Drawn = Pick<SegmentSummary, 'lengthKm' | 'avgGradePercent' | 'measuredAvgGradePercent' | 'profileM'>

/** A segment's grade as every display surface reads it: the measured one when there is one (see `SegmentSummary`). */
export function segmentGrade(segment: Pick<SegmentSummary, 'avgGradePercent' | 'measuredAvgGradePercent'>): number {
  return segment.measuredAvgGradePercent ?? segment.avgGradePercent
}

/** A climb's rise above its start, as a fraction of its length, at even distances along it - its profile, or a straight ramp. */
export function climbRises(climb: Drawn): number[] {
  const lengthM = climb.lengthKm * 1000
  if (climb.profileM && climb.profileM.length > 1 && lengthM > 0) return climb.profileM.map(rise => Math.max(0, rise) / lengthM)
  return [0, Math.max(0, segmentGrade(climb)) / 100]
}

export function wedgeScale(climbs: Drawn[]): WedgeScale {
  return { maxRise: Math.max(0, ...climbs.flatMap(climb => climbRises(climb))) }
}

/** A climb's drawing in a unit box, `x` 0..1 along it and `y` 0..1 of the scale's height, 0 at its start's level. */
export function climbDrawing(climb: Drawn, scale: WedgeScale): { x: number, y: number }[] {
  const rises = climbRises(climb)
  return rises.map((rise, index) => ({
    x: index / (rises.length - 1),
    y: scale.maxRise > 0 ? Math.min(1, rise / scale.maxRise) : 0
  }))
}
