import type { RouteWithMeta } from '../types/catalog'

/**
 * What a course's geometry is built from, which is what "is this course
 * measured?" asks - answered once, here, for every reader: the Course hero's
 * line, the ranking's physics note, the MCP and Twin "Elevation data" lines,
 * the TTT plan's coverage, the evidence line under a time and the speed
 * chart's availability. Before this the question was asked at ten sites with
 * three thresholds (truthy, `> 1`, `>= 2`), which agreed only because no
 * course in the catalog has a one-point profile.
 *
 * IMPORTANT: a client-safe leaf (types only), like `routeOccurrences.ts`:
 * the pages call it in the browser.
 */

/**
 * The fewest profile points that make a measured shape: a single sample has
 * no grade after it, so the simulator would have nothing to place a gradient
 * change along.
 */
export const MEASURED_PROFILE_MIN_POINTS = 2

/**
 * What a course's lap is built from when it is not measured, as the geometry
 * builder builds it: `measured` (the real profile), `named-climbs` (the named
 * climbs at their placements, the rest synthesised from the totals) or
 * `aggregate` (synthesised from the distance and total climbing alone).
 */
export type CourseApproximation = 'measured' | 'named-climbs' | 'aggregate'

export interface CourseCoverage {
  /** The lap has a measured elevation profile. */
  measuredLap: boolean
  /** The lead-in has a measured elevation profile of its own; false when there is no lead-in to measure. */
  measuredLeadIn: boolean
  /** The lap's surfaces are known by position, not only as a mix. */
  positionedSurfaces: boolean
  /** The lead-in's surfaces are known by position. */
  positionedLeadInSurfaces: boolean
  /** What the lap is built from - see `CourseApproximation`. */
  approximation: CourseApproximation
}

/** Whether a profile is a measured shape - see `MEASURED_PROFILE_MIN_POINTS`. */
export function isMeasuredProfile(profile: readonly unknown[] | undefined): boolean {
  return (profile?.length ?? 0) >= MEASURED_PROFILE_MIN_POINTS
}

/**
 * The one coverage rule. A route's named climbs make its geometry
 * `named-climbs` wherever the builder places one - on the lap, or in a
 * lead-in that is ridden - which is also what the ranking's note has always
 * said; a segment carries no named climbs of its own, so an unmeasured one
 * is `aggregate`, its own distance at its own average grade.
 */
export function courseCoverage(course: Pick<RouteWithMeta, 'terrain' | 'surface'> & Partial<Pick<RouteWithMeta, 'leadInDistance'>>): CourseCoverage {
  const measuredLap = isMeasuredProfile(course.terrain.elevationProfile)
  const leadIn = (course.leadInDistance ?? 0) > 0
  const namedClimbs = course.terrain.climbs.some(climb => climb.perLap || leadIn)
  return {
    measuredLap,
    measuredLeadIn: leadIn && isMeasuredProfile(course.terrain.leadInElevationProfile),
    positionedSurfaces: (course.surface.segments?.length ?? 0) > 0,
    positionedLeadInSurfaces: (course.surface.leadInSegments?.length ?? 0) > 0,
    approximation: measuredLap ? 'measured' : namedClimbs ? 'named-climbs' : 'aggregate'
  }
}
