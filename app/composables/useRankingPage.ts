import { raceFormatRules } from '#shared/utils/raceRules'
import { setupName } from '#shared/utils/recommendationAnswer'
import type { RideStatement, RideStatementAnswer } from '../../shared/utils/rideStatement'
import type { Ride } from '../utils/recommendRequest'
import { breadcrumbScript, faqScript } from '../utils/rankingResults'
import {
  rankingPageAnalysisKind,
  rankingPageAnswerRide,
  rankingPageHasLongClimb,
  rankingPageLaps,
  rankingPageReportLine,
  rankingPageShareCard,
  resolveRankingPageRide
} from '../utils/rankingPage'

/** What a Ranking page hands its module: the Ride, the request key and the Ride statement. */
export interface RankingPageInputs<S extends RideStatement> {
  /**
   * The Ride the page ranks, live: it moves the moment a control does. No
   * Ride is nothing to rank - a Category group racing a route the catalog
   * does not have - and then no request goes out.
   */
  ride: () => Ride | undefined
  /** The recommend request's key, passed to `useRecommendRequest` unchanged - see `RecommendRequestOptions.key`. */
  key: string
  /**
   * The page's Ride statement for the live Ride (see `shared/utils/rideStatement`),
   * given rank 1's setup for its description. Undefined until the page knows
   * what its Ride is, and then the head gets no JSON-LD at all.
   */
  statement: (answer: RideStatementAnswer | undefined) => S | undefined
}

/** One Ride as a key: what the page stated for it is remembered under this. */
function rideKey(ride: Ride): string {
  return JSON.stringify(ride)
}

/**
 * The Ranking page module (see **Ranking page** in `CONTEXT.md`): everything
 * a route, segment or race page derives about its Ranking results once it has
 * said what its Ride is. The page hands the result, whole, to
 * `RankingPageBody`, which renders it beneath the page's own header, and keeps
 * for itself only what it states on its own - its heading, its selection
 * control, its Fact row and Course hero, its share card, what to await and
 * when to 404.
 *
 * It exists because the three pages used to wire the same stack by hand, so
 * one change to the Ranking results landed three times. What a page says
 * about its Ride on its own comes in as one Ride statement, which this
 * module hands back for the page's own markup and head, and whose name,
 * question, trail and report subject it puts where they go.
 *
 * Everything that explains a time - the long-climb check, the TTT plan, the
 * answer, "Why this bike wins here", the course analysis, the report line
 * and the share card - comes from the Applied Ranking's course and the
 * Applied Ride's laps, on every page. The page passes no course: on a race
 * page the selector runs ahead of the ranking, and the course a selector has
 * just moved to cannot explain times computed over the previous one. For the
 * same reason the answer and the report line read the statement the page
 * made for the Applied Ride, not the live one. The live readings are the
 * statement itself, the head and the Race format rules - the Rider card's
 * fixed levers and the TT chips above the table follow the rule of the Ride
 * being asked for.
 *
 * Synchronous, like `useRecommendRequest`: the page awaits `ready` itself,
 * alongside its own lookup.
 */
export function useRankingPage<S extends RideStatement>(inputs: RankingPageInputs<S>) {
  const request = useRecommendRequest(inputs.ride, { key: inputs.key })
  const {
    appliedRanking, appliedRide, appliedInputs, appliedRestrictions,
    combos, topCombo, fastestOverall, physics, wheelChoice, isFirstLoad, isRefreshing
  } = request

  const appliedCourse = computed(() => appliedRanking.value.course)
  const appliedLaps = computed(() => rankingPageLaps(appliedRide.value))

  const hasLongClimb = computed(() => rankingPageHasLongClimb(appliedRide.value, appliedCourse.value, appliedInputs.value))

  // One plan for the Fact row's TTT line and the TTT plan tab, built on the
  // Applied Ride resolved as the server times it - a segment on its own
  // geometry, a route over its laps - so its sectors are where the times
  // beside them were simulated. Undefined outside TTT drafting.
  const tttPlan = useTttPlan({
    ride: () => resolveRankingPageRide(appliedRide.value, appliedCourse.value),
    combo: () => topCombo.value,
    rider: () => appliedInputs.value,
    loading: () => isFirstLoad.value
  })

  // The recommendation and the rows pick through one set of picks; the
  // section they are compared in is where "Show comparison" scrolls.
  const comparison = useComparison(() => combos.value)

  // The page's statement for the live Ride, with rank 1 for its description.
  const statementAnswer = computed<RideStatementAnswer | undefined>(() => topCombo.value
    ? { setup: setupName(topCombo.value), category: appliedInputs.value.category }
    : undefined)
  const statement = computed(() => inputs.statement(statementAnswer.value))

  // What the page stated for each Ride it has asked for, so the answer and
  // the report line can name the Applied Ride in the page's words while the
  // live one runs ahead. Only a race page's selector changes the Ride's name;
  // a handful of Rides at most. Synchronous, so a Ride the selector passes
  // straight through is remembered too.
  const stated = shallowRef(new Map<string, S>())
  watch(() => [inputs.ride(), statement.value] as const, ([ride, said]) => {
    if (!ride || !said || stated.value.get(rideKey(ride)) === said) return
    stated.value = new Map(stated.value).set(rideKey(ride), said)
  }, { immediate: true, flush: 'sync' })
  const appliedStatement = computed(() => (appliedRide.value && stated.value.get(rideKey(appliedRide.value))) ?? statement.value)

  // The visible answer and the FAQ structured data are one text, so what a
  // crawler reads is what a rider sees. During a refetch it keeps describing
  // the results still on screen, as the dimmed results do.
  const answerRide = computed(() => rankingPageAnswerRide(appliedRide.value, appliedCourse.value, appliedStatement.value?.rideName))
  const answer = useRecommendationAnswer({
    ranking: () => combos.value,
    fastestOverall: () => fastestOverall.value,
    rideName: () => answerRide.value?.rideName,
    distanceKm: () => answerRide.value?.distanceKm,
    rider: () => appliedInputs.value,
    laps: () => answerRide.value?.laps,
    restrictions: () => appliedRestrictions.value,
    rideRules: () => answerRide.value?.rideRules
  })
  const faqQuestion = computed(() => statement.value?.question)
  const faqAnswer = computed(() => answer.value?.text)

  // The trail is the statement's; the envelope, the keying and the escaping
  // are `rankingResults.ts`'s.
  useHead(() => {
    const trail = statement.value?.breadcrumbs
    if (!trail) return {}
    return {
      script: [breadcrumbScript(trail), faqScript(faqQuestion.value, faqAnswer.value)]
        .filter(script => script !== undefined)
    }
  })

  const reportLine = computed(() => rankingPageReportLine(appliedRide.value, appliedInputs.value, appliedStatement.value?.reportSubject))

  const shareCard = computed(() => rankingPageShareCard(topCombo.value, appliedCourse.value, appliedLaps.value))

  // The Race format rules of the live Ride - what the rider may pick, so a
  // control never offers a value the pending request will discard - with the
  // nudge towards the format's own draft mode read against the Applied one,
  // the draft mode the ranking on screen was computed under.
  const rules = computed(() => raceFormatRules(inputs.ride(), appliedInputs.value.draftMode))
  const hideTtCategory = computed(() => rules.value?.ttFramesBarred ?? false)

  // "Why this bike wins here", about rank 1 on the course its time was
  // computed over.
  const why = computed(() => ({
    course: appliedCourse.value,
    combo: topCombo.value,
    rideName: appliedCourse.value?.name ?? '',
    physicsMode: physics.value?.mode,
    draftMode: appliedInputs.value.draftMode,
    wheelChoice: wheelChoice.value,
    refreshing: isRefreshing.value
  }))

  // The course analysis, Ride-only tabs and equipment tabs alike, for the
  // Applied course and laps - so it waits for a refreshed ranking rather than
  // drawing a course the times on screen were not computed over.
  const courseAnalysis = computed(() => {
    const course = appliedCourse.value
    if (!course) return undefined
    return {
      route: course,
      resultsRoute: course,
      kind: rankingPageAnalysisKind(appliedRide.value),
      laps: appliedLaps.value,
      resultsLaps: appliedLaps.value,
      combo: topCombo.value,
      rider: appliedInputs.value,
      refreshing: isRefreshing.value,
      loading: isFirstLoad.value,
      plan: tttPlan.value
    }
  })

  return {
    /** The recommend request, whole - what `RideResults` is handed. */
    request,
    /** Awaited by the page, alongside its own lookup. */
    ready: request.ready,
    /** The comparison picks, which the rows toggle and the comparison section shows. */
    comparison,
    /** The lap count the times on screen were computed for; 1 on a segment. */
    appliedLaps,
    /** Whether the Ride has a long climb for the Applied rider - the Rider card's `hasLongClimb`. */
    hasLongClimb,
    /** The TTT plan, under TTT drafting only - the Fact row's TTT line and the plan tab read it. */
    tttPlan,
    /** The answer under the Recommendation. */
    answer,
    /** The question the statement asks - the answer's heading and the FAQ entry's question. */
    faqQuestion,
    /** The answer's text, which the FAQ JSON-LD carries. */
    faqAnswer,
    /** What a report filed from the page says the ranking was ridden as. */
    reportLine,
    /** What the page's share card says about the Ranking - read once, at setup. */
    shareCard,
    /** The page's Ride statement for the live Ride - its heading, Fact row, head and share card read it. */
    statement,
    /** The live Ride's Race format rules, with the draft nudge for the Applied draft mode; undefined when it is told no format. */
    rules,
    /** Whether the chips above the table drop the TT category. */
    hideTtCategory,
    /** What "Why this bike wins here" renders from. */
    why,
    /** What the course analysis renders from; absent until the Applied course is known. */
    courseAnalysis,
    /** For the page's `useSharedView`. */
    bikeSearch: request.bikeSearch,
    bikeSearchDebounced: request.bikeSearchDebounced
  }
}

/** Everything a Ranking page derives about its Ranking results - what `RankingPageBody` is handed whole. */
export type RankingPage<S extends RideStatement = RideStatement> = ReturnType<typeof useRankingPage<S>>
