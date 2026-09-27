import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, ref, watch } from 'vue'
import { getRouteBySlug } from '#shared/utils/catalog'
import { categoryGroupRacing, formatCategoryGroup, getRaceBySlug } from '#shared/utils/events'
import { getSegmentSummary, routeWithMetaForSegment } from '#shared/utils/routeSegments'
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import { rideRulesForFormat, type AppliedRiderInputs, type Ride, type RiderInputs } from '../utils/recommendRequest'
import type { StructuredDataScript } from '../utils/rankingResults'
import { useComparison } from './useComparison'
import { useRankingPage, type RankingPageInputs } from './useRankingPage'
import { useRecommendationAnswer } from './useRecommendationAnswer'
import { useTttPlan } from './useTttPlan'

const hilly = getRouteBySlug('hilly-route')!
const rank1 = { frame: { name: 'Specialized Tarmac SL9' }, wheelset: { name: 'Shimano C99/Disc' }, finishTimeSec: 1500 } as ComboScore
const restrictions = {
  verifiedOnly: true, includeHaloBikes: false, myBikesOnly: false, owned: {}, ownedWheels: {}, search: ''
} as unknown as RiderInputs

/**
 * The module over a stand-in recommend request whose Applied values the test
 * sets directly - which is the whole of what the module reads from it - and
 * the real composables it wraps. The request itself is tested in
 * `useRecommendRequest.test.ts`.
 */
function setup(overrides: Partial<RankingPageInputs> = {}) {
  const liveRide = ref<Ride | undefined>({ course: { kind: 'route', slug: 'hilly-route' }, laps: 1 })
  const appliedRide = ref<Ride | undefined>({ course: { kind: 'route', slug: 'hilly-route' }, laps: 1 })
  const appliedCourse = ref<RouteWithMeta | undefined>(hilly)
  const appliedInputs = ref<AppliedRiderInputs>({
    weightKg: 75, heightCm: 175, powerW: 225, draftMode: 'solo', tttRiders: 4, tttClimbWkg: undefined, category: 'all'
  })
  const combos = ref<ComboScore[]>([rank1])
  const ready = Promise.resolve()
  const request = {
    ready,
    combos,
    topCombo: computed(() => combos.value[0]),
    fastestOverall: computed(() => undefined),
    wheelChoice: computed(() => undefined),
    physics: computed(() => ({ mode: 'dynamic', note: '' })),
    appliedRide,
    appliedInputs,
    appliedRestrictions: computed(() => restrictions),
    appliedRanking: computed(() => ({ course: appliedCourse.value })),
    isFirstLoad: computed(() => false),
    isRefreshing: computed(() => false),
    bikeSearch: ref(''),
    bikeSearchDebounced: ref('')
  }
  const useRecommendRequest = vi.fn((_ride: () => Ride | undefined, _options: { key: string }) => request)
  let head: () => { script?: StructuredDataScript[] } = () => ({})
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useRecommendRequest', useRecommendRequest)
  vi.stubGlobal('useTttPlan', useTttPlan)
  vi.stubGlobal('useComparison', useComparison)
  vi.stubGlobal('useRecommendationAnswer', useRecommendationAnswer)
  vi.stubGlobal('useHead', (input: typeof head) => {
    head = input
  })
  const scope = effectScope()
  scopes.push(scope)
  const page = scope.run(() => useRankingPage({
    ride: () => liveRide.value,
    key: 'recommend-route-hilly-route',
    rideName: (course, laps) => `${laps === 1 ? '' : `${laps} laps of `}${course.name} in ${course.worldName}`,
    faqQuestion: () => 'What\'s the fastest bike for Watopia Hilly Route?',
    breadcrumbs: () => [{ name: 'Home', item: 'https://example.test' }, { name: 'Watopia Hilly Route', item: 'https://example.test/routes/hilly-route' }],
    ...overrides
  }))!
  return { page, request, useRecommendRequest, liveRide, appliedRide, appliedCourse, appliedInputs, combos, head: () => head() }
}

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.unstubAllGlobals()
})

describe('useRankingPage', () => {
  it('hands the Ride and the request key to the recommend request unchanged, and is ready when it is', () => {
    const { page, request, useRecommendRequest, liveRide } = setup()
    const [ride, options] = useRecommendRequest.mock.calls[0]!
    expect(ride()).toBe(liveRide.value)
    expect(options).toEqual({ key: 'recommend-route-hilly-route' })
    expect(page.request).toBe(request)
    expect(page.ready).toBe(request.ready)
    expect(page.bikeSearch).toBe(request.bikeSearch)
    expect(page.bikeSearchDebounced).toBe(request.bikeSearchDebounced)
  })

  it('answers in the page\'s words for the Applied course and laps, and gives the FAQ the same text', () => {
    const { page, appliedRide } = setup()
    appliedRide.value = { course: { kind: 'route', slug: 'hilly-route' }, laps: 3 }
    expect(page.answer.value?.text).toMatch(/^ZwiftBikes predicts the Specialized Tarmac SL9 with Shimano C99\/Disc is the best bike and wheels for 3 laps of Watopia Hilly Route in Watopia: /)
    expect(page.answer.value?.text).toContain('3 laps, including any lead-in once')
    expect(page.faqAnswer.value).toBe(page.answer.value?.text)
  })

  it('sets the breadcrumb and FAQ JSON-LD in the head, and nothing before the page knows its trail', () => {
    const trail = ref<{ name: string, item: string }[] | undefined>(undefined)
    const { page, head } = setup({ breadcrumbs: () => trail.value })
    expect(head()).toEqual({})
    trail.value = [{ name: 'Home', item: 'https://example.test' }]
    const [breadcrumbs, faq] = head().script!
    expect(JSON.parse(breadcrumbs!.innerHTML).itemListElement).toEqual([{ '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://example.test' }])
    const question = JSON.parse(faq!.innerHTML).mainEntity[0]
    expect(question.name).toBe('What\'s the fastest bike for Watopia Hilly Route?')
    expect(question.acceptedAnswer.text).toBe(page.answer.value?.text)
  })

  it('has a TTT plan only under TTT drafting', () => {
    // No ranked setup, so the plan needs no frame physics: its sectors wait
    // for rank 1, and whether a plan exists at all is the draft's to decide.
    const { page, appliedInputs, combos } = setup()
    combos.value = []
    expect(page.tttPlan.value).toBeUndefined()
    appliedInputs.value = { ...appliedInputs.value, draftMode: 'race' }
    expect(page.tttPlan.value).toBeUndefined()
    appliedInputs.value = { ...appliedInputs.value, draftMode: 'ttt', tttRiders: 5 }
    expect(page.tttPlan.value).toMatchObject({ sectors: [], hasSetup: false, loading: false, riders: 5 })
  })

  it('explains the times with the Applied Ride while the live one runs ahead', () => {
    const { page, liveRide } = setup()
    liveRide.value = { course: { kind: 'route', slug: 'hilly-route' }, laps: 3, ttFramesAllowed: false }
    expect(page.appliedLaps.value).toBe(1)
    expect(page.courseAnalysis.value).toMatchObject({ route: hilly, resultsRoute: hilly, kind: 'route', laps: 1, resultsLaps: 1 })
    expect(page.why.value).toMatchObject({ course: hilly, combo: rank1, rideName: 'Watopia Hilly Route', physicsMode: 'dynamic', draftMode: 'solo' })
    expect(page.reportLine.value).toBe('1 lap, 225 W, Solo')
    // The one live reading: the TT chips follow the rule of the Ride being asked for.
    expect(page.hideTtCategory.value).toBe(true)
  })

  it('has no course analysis until the Applied course is known', () => {
    const { page, appliedCourse } = setup()
    appliedCourse.value = undefined
    expect(page.courseAnalysis.value).toBeUndefined()
    expect(page.answer.value).toBeUndefined()
    expect(page.hasLongClimb.value).toBe(true)
  })

  it('fills the share card from rank 1 and the Applied course', () => {
    const { page, combos } = setup()
    expect(page.shareCard.value).toMatchObject({ frameName: 'Specialized Tarmac SL9', wheelName: 'Shimano C99/Disc' })
    expect(page.shareCard.value.silhouette?.heights).toHaveLength(120)
    combos.value = []
    expect(page.shareCard.value).toMatchObject({ frameName: undefined, wheelName: undefined })
  })

  it('leads the report line with the page\'s subject for the Applied Ride', () => {
    const { page } = setup({ reportSubject: ride => ride?.laps === 1 ? 'A/B' : undefined })
    expect(page.reportLine.value).toBe('A/B, 1 lap, 225 W, Solo')
  })

  describe('on a segment page', () => {
    const fuego = routeWithMetaForSegment(getSegmentSummary('fuego-flats')!)
    const sprint: Ride = { course: { kind: 'segment', slug: 'fuego-flats' }, power: 'sprint' }

    // The segment page's own inputs: its words ignore the lap count, and the
    // report line says which kind of segment the Applied Ride was.
    function segmentSetup(ride: Ride) {
      const page = setup({
        key: 'recommend-segment-fuego-flats',
        rideName: course => `the ${course.name} sprint in ${course.worldName}`,
        faqQuestion: () => 'What\'s the fastest bike for the Fuego Flats sprint?',
        reportSubject: applied => applied?.power === 'sprint' ? 'Sprint segment' : 'Climbing segment'
      })
      page.liveRide.value = ride
      page.appliedRide.value = ride
      page.appliedCourse.value = fuego
      page.appliedInputs.value = { ...page.appliedInputs.value, powerW: 800 }
      return page
    }

    it('rides the segment once, and answers for its own length with no lap count', () => {
      const { page } = segmentSetup(sprint)
      expect(page.appliedLaps.value).toBe(1)
      expect(page.answer.value?.text).toMatch(/^ZwiftBikes predicts the Specialized Tarmac SL9 with Shimano C99\/Disc is the best bike and wheels for the Fuego Flats sprint in Watopia: /)
      expect(page.answer.value?.text).not.toMatch(/\blaps?\b/)
      expect(page.courseAnalysis.value).toMatchObject({ route: fuego, resultsRoute: fuego, kind: 'sprint', laps: 1, resultsLaps: 1 })
      expect(page.why.value.rideName).toBe('Fuego Flats')
      expect(page.reportLine.value).toBe('Sprint segment, 800 W sprint power, Solo')
    })

    it('states the Race format\'s rules and hides the TT category when a link barred TT frames', () => {
      const { page } = segmentSetup({ ...sprint, ...rideRulesForFormat('rot') })
      expect(page.answer.value?.summary).toMatch(/^WTRL bans TT bikes from its Race of Truth.* ZwiftBikes predicts /)
      expect(page.hideTtCategory.value).toBe(true)
    })

    it('keeps the TT category under a format that allows TT frames, and with no format at all', () => {
      expect(segmentSetup({ ...sprint, ...rideRulesForFormat('ttt') }).page.hideTtCategory.value).toBe(false)
      expect(segmentSetup(sprint).page.hideTtCategory.value).toBe(false)
    })
  })
  describe('on a race page', () => {
    // A/B race Makuri 40, C/D Urumaze - a points race, which bars TT frames.
    const race = getRaceBySlug('zrl-2026-27', 'round-1-week-3')!
    const makuri40 = getRouteBySlug('makuri-40')!
    const urumaze = getRouteBySlug('4092230492')!
    const groupRide = (index: number, format = race.format!): Ride => ({
      course: { kind: 'route', slug: race.categories[index]!.routeSlug! },
      laps: race.categories[index]!.laps,
      ...rideRulesForFormat(format)
    })

    // The race page's own inputs: the lap count leads the name, and the
    // report line names the Category group the Applied Ride was ranked for.
    function raceSetup() {
      const page = setup({
        key: 'recommend-race-zrl-2026-27-round-1-week-3',
        rideName: (course, laps) => `${laps} lap${laps === 1 ? '' : 's'} of ${course.name} in ${course.worldName}`,
        faqQuestion: () => 'What bike should I ride for ZRL 2026/27 Round 1 Week 3?',
        reportSubject: (applied) => {
          const group = categoryGroupRacing(race, applied?.course.slug, applied?.laps)
          return group ? formatCategoryGroup(group) : undefined
        }
      })
      page.liveRide.value = groupRide(0)
      page.appliedRide.value = groupRide(0)
      page.appliedCourse.value = makuri40
      return page
    }

    it('explains the ranking with the Applied Category group while the selector runs ahead to another', () => {
      const { page, liveRide } = raceSetup()
      liveRide.value = groupRide(1)
      expect(page.answer.value?.text).toMatch(/^TT bikes are disabled for this points race\. ZwiftBikes predicts the Specialized Tarmac SL9 with Shimano C99\/Disc is the best bike and wheels for 1 lap of Makuri 40 in Makuri Islands: /)
      // 40.252 km - the lap and the lead-in once - in 25:00.
      expect(page.answer.value?.text).toContain('finishing in 25:00 (~96.6 km/h)')
      expect(page.courseAnalysis.value).toMatchObject({ route: makuri40, resultsRoute: makuri40, kind: 'route', laps: 1 })
      expect(page.reportLine.value).toBe('A/B, ridden as a points race, 1 lap, 225 W, Solo, TT frames barred')
      expect(page.hideTtCategory.value).toBe(true)
    })

    it('names the group the selector moved to once its ranking has landed', () => {
      const { page, liveRide, appliedRide, appliedCourse } = raceSetup()
      liveRide.value = groupRide(1)
      appliedRide.value = groupRide(1)
      appliedCourse.value = urumaze
      expect(page.answer.value?.text).toContain('for 1 lap of Urumaze in Makuri Islands: ')
      expect(page.reportLine.value).toBe('C/D, ridden as a points race, 1 lap, 225 W, Solo, TT frames barred')
      expect(page.why.value.rideName).toBe('Urumaze')
    })

    it('shows the TT category in a team time trial, whose format allows TT frames', () => {
      const { page, liveRide } = raceSetup()
      liveRide.value = groupRide(0, 'ttt')
      expect(page.hideTtCategory.value).toBe(false)
    })

    it('ranks nothing for a Category group with no catalog route', () => {
      const { page, liveRide, useRecommendRequest } = raceSetup()
      liveRide.value = undefined
      expect(useRecommendRequest.mock.calls[0]![0]()).toBeUndefined()
      expect(page.hideTtCategory.value).toBe(false)
    })
  })
})
