import type { RouteClimb } from '../../shared/types/catalog'
import type { RecommendRide } from '../../shared/types/recommendRide'

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
 * The Ride's mapped climbs and sprints as one list in ride order, for its
 * lap count - what a rider meets first comes first, whichever kind it is,
 * rather than every climb and then every sprint. The passes are the resolved
 * Ride's own (`RecommendRide.climbs` / `sprints`), so a row's position is the
 * same kilometre the Course hero's band sits on and its Climb time is cut at.
 */
export function courseSegmentsInRideOrder(ride: Pick<RecommendRide, 'climbs' | 'sprints'>): CourseSegment[] {
  const climbs = ride.climbs.map((climb): CourseSegment => ({
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
  const sprints = ride.sprints.map((sprint): CourseSegment => ({
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
