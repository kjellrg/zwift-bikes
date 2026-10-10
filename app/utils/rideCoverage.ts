import type { CourseCoverage } from '../../shared/utils/courseCoverage'
import { surfaceCoverageLine } from '#shared/utils/rideFacts'

// `surfaceCoverageLine` now lives in `shared/utils/rideFacts.ts`, with the
// Fact row's coverage note the Ride statement builds from it (issue #318).
export { surfaceCoverageLine }

/**
 * The one-line warning beside a finish time whose course inputs are partly
 * missing. Undefined when nothing is - the common case, so the line only
 * appears where it changes how much to trust the number.
 */
export function limitedCourseDataNote(coverage: Pick<CourseCoverage, 'measuredLap' | 'positionedSurfaces'>): string | undefined {
  if (coverage.measuredLap && coverage.positionedSurfaces) return undefined
  const missing = !coverage.measuredLap && !coverage.positionedSurfaces
    ? 'elevation and surface locations unavailable'
    : !coverage.measuredLap ? 'elevation profile unavailable' : 'surface locations unavailable'
  return `Limited route data: ${missing}.`
}
