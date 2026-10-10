import type { RouteWithMeta, SegmentSummary } from '../../types/catalog'
import { raceFormatRules } from '../raceRules'
import type { Ride } from '../recommendQuery'
import { rideDescription } from '../rideDescription'
import { surfaceSplit } from '../rideFacts'
import { formatDistance, formatElevation, formatGrade } from '../units'
import type { RideStatementAnswer, RideStatementBase } from './types'

export interface SegmentStatementInputs {
  segment: SegmentSummary
  /**
   * The segment-as-route it is ranked on (`routeWithMetaForSegment`), which
   * carries its surface mix; the Fact row waits for it.
   */
  course: RouteWithMeta | undefined
  /** The live Ride: sprint power or not, and the Race format it is told, if any. */
  ride: Ride
  siteUrl: string
  answer?: RideStatementAnswer
}

export interface SegmentStatement extends RideStatementBase {
  kind: 'segment'
  /** What the time covers, beneath the Fact row. */
  timingNote: string
  /** The routes it is ridden on, each linked - "Also on ...". */
  hostRoutes: { name: string, to: string }[]
  /** Where no host route places it, why its figures are its own record's. */
  placementNote: string | undefined
  /** The share card's own text, beside rank 1 and the Silhouette (`SegmentCard`). */
  shareCard: { props: { title: string, kind: string, world: string, length: string, elevation: string, grade: string }, alt: string }
}

/**
 * A segment page's Ride statement. Its figures prefer the measured-profile
 * pair where there is one (see `SegmentSummary`), so the snippet, the Fact
 * row, the share card and the chart all describe the same road.
 */
export function segmentStatement({ segment, course, ride, siteUrl, answer }: SegmentStatementInputs): SegmentStatement {
  const { name, type, worldName: world } = segment
  const elevationM = segment.measuredElevationM ?? segment.elevationM
  const gradePercent = segment.measuredAvgGradePercent ?? segment.avgGradePercent
  const grade = gradePercent ? formatGrade(gradePercent) : 'Flat'
  // "category 2", "HC" - a climb's category, as the crumb and the share card name it.
  const climbCategory = type === 'climb' && segment.climbType ? (segment.climbType === 'HC' ? 'HC' : `category ${segment.climbType}`) : undefined
  // Stat-rich for SERP snippets: "12.2 km at 8.5%" is what long-tail queries
  // ("alpe du zwift gradient") contain. The climbing clause is skipped for
  // near-flat segments (most sprints), where "0 m of climbing" is noise.
  const stats = `${formatDistance(segment.lengthKm)}${gradePercent ? ` at ${formatGrade(gradePercent)}` : ', flat'}${elevationM >= 10 ? `, ${formatElevation(elevationM)} of climbing` : ''}`
  const description = rideDescription({ ride: `the ${name} ${type}`, world, stats, setup: answer?.setup, category: answer?.category ?? 'all' })
  return {
    kind: 'segment',
    rideName: `the ${name} ${type} in ${world}`,
    question: `What's the fastest bike for the ${name} ${type}?`,
    title: `Fastest bike for the ${name} ${type} | ZwiftBikes`,
    description,
    ogTitle: `Fastest bike for the ${name} ${type}`,
    ogDescription: description,
    heading: {
      name,
      crumbs: [
        { label: 'All segments', to: '/segments' },
        { label: world },
        { label: type === 'sprint' ? 'Sprint' : climbCategory ? `Climb, ${climbCategory}` : 'Climb' }
      ]
    },
    // A segment sits under the segments hub.
    breadcrumbs: [
      { name: 'Home', item: siteUrl },
      { name: 'Segments', item: `${siteUrl}/segments` },
      { name, item: `${siteUrl}/segments/${segment.slug}` }
    ],
    reportItem: name,
    // Off the Ride rather than the segment's type, so the power and the word
    // for it can never disagree.
    reportSubject: ride.power === 'sprint' ? 'Sprint segment' : 'Climbing segment',
    facts: course
      ? [
          { value: formatDistance(segment.lengthKm), label: 'long' },
          { value: formatElevation(elevationM), label: 'of climbing' },
          { value: grade, label: 'average grade' }
        ]
      : [],
    surface: course ? surfaceSplit(course.surface.composition) : undefined,
    rules: raceFormatRules(ride),
    timingNote: 'Timed from the segment\'s start and ridden once; the flying-start warm-up is not counted.',
    // The host routes: how a rider moves on from one stretch to a whole ride.
    hostRoutes: segment.hostRoutes.map(host => ({ name: host.name, to: `/routes/${host.slug}` })),
    placementNote: segment.placement === 'membership'
      ? 'The exact position of this segment along its host routes isn\'t in our route data, so length and grade come from the segment\'s own record, and the surface estimate is borrowed from the host route\'s overall mix.'
      : undefined,
    shareCard: {
      props: {
        title: name,
        kind: type === 'sprint' ? 'sprint' : climbCategory ? `${climbCategory} climb` : 'climb',
        world,
        length: formatDistance(segment.lengthKm),
        elevation: formatElevation(elevationM),
        grade
      },
      alt: `Fastest bike for the ${name} ${type} in ${world}: segment profile and the fastest bike and wheel setup`
    }
  }
}
