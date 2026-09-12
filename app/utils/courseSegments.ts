import type { RouteClimb, RouteWithMeta } from '../../shared/types/catalog'
import { expandClimbsForLaps, expandSprintsForLaps } from '#shared/utils/routeOccurrences'

/**
 * One row of the Segments tab: a mapped climb or sprint occurrence, in the
 * place it is ridden.
 */
export interface CourseSegment {
  kind: 'climb' | 'sprint'
  slug: string
  name: string
  climbType?: RouteClimb['climbType']
  /** Position from the true start of the ride, lead-in included, across all laps ridden. */
  rideFromKm: number
  rideToKm: number
  /** 1-indexed lap, only when more than one is ridden. Absent for lead-in items, which never repeat. */
  lapNumber?: number
  /** Ridden once in the lead-in rather than once per lap. */
  leadIn: boolean
  lengthKm: number
  /** Climbs only: a sprint's climbing is not a meaningful number (see `RouteSegmentPlacement`). */
  elevationM?: number
  avgGradePercent: number
}

/**
 * The route's mapped climbs and sprints as one list in ride order, for the
 * selected lap count - what a rider meets first comes first, whichever kind
 * it is, rather than every climb and then every sprint. Lap expansion is the
 * pages' existing `expandClimbsForLaps` / `expandSprintsForLaps`, so a row's
 * position is the same kilometre the elevation chart's marker sits on.
 */
export function courseSegmentsInRideOrder(route: RouteWithMeta, laps: number): CourseSegment[] {
  const climbs = expandClimbsForLaps(route, laps).map((climb): CourseSegment => ({
    kind: 'climb',
    slug: climb.slug,
    name: climb.name,
    climbType: climb.climbType,
    rideFromKm: climb.rideFromKm,
    rideToKm: climb.rideToKm,
    lapNumber: climb.lapNumber,
    leadIn: !climb.perLap,
    lengthKm: climb.lengthKm,
    elevationM: climb.elevationM,
    avgGradePercent: climb.avgGradePercent
  }))
  const sprints = expandSprintsForLaps(route, laps).map((sprint): CourseSegment => ({
    kind: 'sprint',
    slug: sprint.slug,
    name: sprint.name,
    rideFromKm: sprint.rideFromKm,
    rideToKm: sprint.rideToKm,
    lapNumber: sprint.lapNumber,
    leadIn: !sprint.perLap,
    lengthKm: sprint.lengthKm,
    avgGradePercent: sprint.avgGradePercent
  }))
  return [...climbs, ...sprints].sort((first, second) => first.rideFromKm - second.rideFromKm)
}
