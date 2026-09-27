import type { Ride } from '../utils/recommendRequest'
import { breadcrumbScript, faqScript } from '../utils/rankingResults'
import {
  rankingPageAnalysisKind,
  rankingPageAnswerRide,
  rankingPageHasLongClimb,
  rankingPageLaps,
  rankingPageReportLine,
  rankingPageShareCard,
  type RankingPageReportSubject,
  type RankingPageRideName
} from '../utils/rankingPage'

/** What a Ranking page says about itself - everything the module cannot know. */
export interface RankingPageInputs {
  /**
   * The Ride the page ranks, live: it moves the moment a control does. No
   * Ride is nothing to rank - a Category group racing a route the catalog
   * does not have - and then no request goes out.
   */
  ride: () => Ride | undefined
  /** The recommend request's key, passed to `useRecommendRequest` unchanged - see `RecommendRequestOptions.key`. */
  key: string
  /** The Ride's display name, for the Applied course and the Applied laps - see `RankingPageRideName`. */
  rideName: RankingPageRideName
  /** The question the page's title asks: the answer section's heading and the FAQ entry's question. */
  faqQuestion: () => string | undefined
  /**
   * The page's own breadcrumb trail, first crumb first. Undefined until the
   * page knows what it is about, and then the head gets no JSON-LD at all.
   */
  breadcrumbs: () => readonly { name: string, item: string }[] | undefined
  /** What the report line leads with where the URL does not say it; a route page has none. */
  reportSubject?: RankingPageReportSubject
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
 * one change to the Ranking results landed three times.
 *
 * Everything that explains a time - the long-climb check, the TTT plan, the
 * answer, "Why this bike wins here", the course analysis, the report line
 * and the share card - comes from the Applied Ranking's course and the
 * Applied Ride's laps, on every page. The page passes no course: on a race
 * page the selector runs ahead of the ranking, and the course a selector has
 * just moved to cannot explain times computed over the previous one. The one
 * live reading is the TT chips above the table, which follow the rule of the
 * Ride being asked for.
 *
 * Synchronous, like `useRecommendRequest`: the page awaits `ready` itself,
 * alongside its own lookup.
 */
export function useRankingPage(inputs: RankingPageInputs) {
  const request = useRecommendRequest(inputs.ride, { key: inputs.key })
  const {
    appliedRanking, appliedRide, appliedInputs, appliedRestrictions,
    combos, topCombo, fastestOverall, physics, wheelChoice, isFirstLoad, isRefreshing
  } = request

  const appliedCourse = computed(() => appliedRanking.value.course)
  const appliedLaps = computed(() => rankingPageLaps(appliedRide.value))

  const hasLongClimb = computed(() => rankingPageHasLongClimb(appliedRide.value, appliedCourse.value, appliedInputs.value))

  // One plan for the Fact row's TTT line and the TTT plan tab. Undefined
  // outside TTT drafting.
  const tttPlan = useTttPlan({
    route: () => appliedCourse.value,
    combo: () => topCombo.value,
    rider: () => appliedInputs.value,
    laps: () => appliedLaps.value,
    loading: () => isFirstLoad.value
  })

  // The recommendation and the rows pick through one set of picks; the
  // section they are compared in is where "Show comparison" scrolls.
  const comparison = useComparison(() => combos.value)

  // The visible answer and the FAQ structured data are one text, so what a
  // crawler reads is what a rider sees. During a refetch it keeps describing
  // the results still on screen, as the dimmed results do.
  const answerRide = computed(() => rankingPageAnswerRide(appliedRide.value, appliedCourse.value, inputs.rideName))
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
  const faqQuestion = computed(() => inputs.faqQuestion())
  const faqAnswer = computed(() => answer.value?.text)

  // The trail is the page's; the envelope, the keying and the escaping are
  // `rankingResults.ts`'s.
  useHead(() => {
    const trail = inputs.breadcrumbs()
    if (!trail) return {}
    return {
      script: [breadcrumbScript(trail), faqScript(faqQuestion.value, faqAnswer.value)]
        .filter(script => script !== undefined)
    }
  })

  const reportLine = computed(() => rankingPageReportLine(appliedRide.value, appliedInputs.value, inputs.reportSubject))

  const shareCard = computed(() => rankingPageShareCard(topCombo.value, appliedCourse.value, appliedLaps.value))

  const hideTtCategory = computed(() => inputs.ride()?.ttFramesAllowed === false)

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
    faqQuestion,
    /** The answer's text, which the FAQ JSON-LD carries. */
    faqAnswer,
    /** What a report filed from the page says the ranking was ridden as. */
    reportLine,
    /** What the page's share card says about the Ranking - read once, at setup. */
    shareCard,
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
export type RankingPage = ReturnType<typeof useRankingPage>
