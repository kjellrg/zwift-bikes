import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import type { RecommendRide } from '../../shared/types/recommendRide'
import type { Silhouette } from '../../shared/utils/silhouette'
import { detectLongClimbBlocks } from '#shared/utils/physics/draft'
import { raceFormatRules } from '#shared/utils/raceRules'
import { rideForRoute, rideForSegment } from '#shared/utils/recommendRide'
import { computeRouteTotals } from '#shared/utils/routeLaps'
import { routeSilhouette } from '#shared/utils/silhouette'
import { OG_SILHOUETTE_SAMPLES } from './ogProfile'
import type { AppliedRiderInputs, Ride } from './recommendRequest'
import { formatRideLine } from './report'

/**
 * The rules behind a Ranking page (see `CONTEXT.md`) that need no Nuxt: what
 * `useRankingPage` derives from the Applied Ride, the Applied Ranking's course
 * and the Applied rider. Split out so each is testable in the plain node
 * environment the suite runs in.
 *
 * Everything here reads Applied values, on every ranking page: the course the
 * times were computed over, never the one a selector has just moved to, so
 * nothing explains a time with a course or a lap count it was not computed
 * for. On a route or segment page those are one course from first to last;
 * on a race page the group selector runs ahead of them.
 */

/** The Applied laps: the Applied Ride's lap count, or one - a segment is ridden once, and no Ride is none. */
export function rankingPageLaps(ride: Ride | undefined): number {
  return ride?.laps ?? 1
}

/**
 * What the course analysis is analysing, read off the Applied Ride: a route
 * gets the Segments tab, a sprint has no speed chart. A segment is ridden at
 * sprint power exactly when it is a sprint, so the Ride already says which
 * kind of segment it is.
 */
export function rankingPageAnalysisKind(ride: Ride | undefined): 'route' | 'climb' | 'sprint' {
  if (ride?.course.kind !== 'segment') return 'route'
  return ride.power === 'sprint' ? 'sprint' : 'climb'
}

/**
 * The Applied Ride resolved against its course, as the server times it -
 * a route from its lead-in over the laps, a segment on its own geometry.
 * Absent until the Applied Ranking's course is known.
 */
export function resolveRankingPageRide(ride: Ride | undefined, course: RouteWithMeta | undefined): RecommendRide | undefined {
  if (!ride || !course) return undefined
  return ride.course.kind === 'segment'
    ? rideForSegment(course, ride.ttFramesAllowed === false)
    : rideForRoute(course, rankingPageLaps(ride), ride.ttFramesAllowed === false)
}

/**
 * Whether the resolved Applied Ride (`resolveRankingPageRide`) has a long
 * climb for the Applied rider - whether the Rider
 * card's team climb pace lever is worth showing (its `hasLongClimb`). Keyed
 * on the power the ride was ridden at, never on the team climb pace itself:
 * the climb pace must not decide its own slider's visibility, or the control
 * vanishes under the rider's cursor as they drag it.
 *
 * True while the course is not known, so the lever is not taken away on a
 * guess.
 */
export function rankingPageHasLongClimb(
  ride: RecommendRide | undefined,
  rider: Pick<AppliedRiderInputs, 'powerW' | 'weightKg'>
): boolean {
  return ride ? detectLongClimbBlocks(ride.planGeometry(), rider.powerW, rider.weightKg).length > 0 : true
}

/** The Ride's half of the answer under the Recommendation - what `useRecommendationAnswer` takes from the page's side. */
export interface RankingPageAnswerRide {
  rideName: string
  /** What the time covers, for the km/h: the laps and the lead-in once, or the segment's own length. */
  distanceKm: number
  /** The Applied laps where the Ride has laps; absent on a segment, whose answer names its timed scope instead. */
  laps: number | undefined
  /** The Race format rules line, when the Applied Ride was ranked under one - see `raceFormatRules`. */
  rideRules: string | undefined
}

/**
 * The Ride's half of the answer, from the Applied Ride, the Applied
 * Ranking's course and the name the Ride statement gave that Ride, so the
 * answer describes the ranking on screen rather than the one a control is
 * about to ask for. The name names the course rather than describing it: the
 * lap count is the answer's scope line to state, and a name that stated it
 * too would say it twice (issue #291). Absent until that course is known.
 */
export function rankingPageAnswerRide(
  ride: Ride | undefined,
  course: RouteWithMeta | undefined,
  rideName: string | undefined
): RankingPageAnswerRide | undefined {
  if (!ride || !course || rideName === undefined) return undefined
  const laps = rankingPageLaps(ride)
  return {
    rideName,
    distanceKm: computeRouteTotals(course, laps).distanceKm,
    laps: ride.laps,
    rideRules: raceFormatRules(ride)?.rulesLine
  }
}

/**
 * What a report filed from the page says the ranking was ridden as - see
 * `formatRideLine` - led by the subject the Ride statement gave the Applied
 * Ride where the URL does not say it ("Sprint segment", the Applied Category
 * group), so it names the ranking on screen rather than the selector's choice.
 */
export function rankingPageReportLine(
  ride: Ride | undefined,
  rider: Pick<AppliedRiderInputs, 'powerW' | 'draftMode' | 'tttRiders'>,
  subject?: string
): string {
  return formatRideLine({ subject, ride, rider })
}

/**
 * What a ranking page's share card says about the Ranking: rank 1's frame and
 * wheels, and the Applied course's Silhouette for the Applied laps. Everything
 * else on the card - its template, its text, its alt text, and whether there
 * is a card at all - is the page's own.
 *
 * Combo names rather than a finish time: a time is only meaningful for one
 * rider, and a card is snapshotted once, for the default one.
 */
export interface RankingPageShareCard {
  frameName: string | undefined
  wheelName: string | undefined
  /** Absent for a course with no measured profile - the card draws none rather than a made-up ramp. */
  silhouette: Silhouette | undefined
}

export function rankingPageShareCard(combo: Pick<ComboScore, 'frame' | 'wheelset'> | undefined, course: RouteWithMeta | undefined, laps: number): RankingPageShareCard {
  return {
    frameName: combo?.frame.name,
    wheelName: combo?.wheelset?.name,
    silhouette: course ? routeSilhouette(course, laps, OG_SILHOUETTE_SAMPLES) : undefined
  }
}
