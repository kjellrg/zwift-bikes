import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, ref, shallowRef, watch, type Ref } from 'vue'
import { getFrames, getRouteBySlug } from '#shared/utils/catalog'
import { getRaceBySlug, getSeasonBySlug } from '#shared/utils/events'
import { raceStatement, routeStatement, segmentStatement, type RaceWithFormat, type RideStatement } from '#shared/utils/rideStatement'
import { getSegmentSummary, routeWithMetaForSegment } from '#shared/utils/routeSegments'
import { getWheelsets } from '#shared/utils/wheelsets'
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import { rideRulesForFormat, type AppliedRiderInputs, type Ride, type RiderInputs } from '../utils/recommendRequest'
import type { StructuredDataScript } from '../utils/rankingResults'
import { useComparison } from './useComparison'
import { useRankingPage, type RankingPageInputs } from './useRankingPage'
import { useRecommendationAnswer } from './useRecommendationAnswer'
import { useTttPlan } from './useTttPlan'

const hilly = getRouteBySlug('hilly-route')!
const rank1 = { frame: { name: 'Specialized Tarmac SL9' }, wheelset: { name: 'Shimano C99/Disc' }, finishTimeSec: 1500 } as ComboScore
/** A rank 1 with real frame physics, for the TTT plan's sectors. */
const zwiftCarbon = {
  frame: getFrames().find(frame => frame.name === 'Zwift Carbon')!,
  wheelset: getWheelsets().find(wheelset => wheelset.name === 'Zwift 32mm Carbon')!,
  finishTimeSec: 1500
} as ComboScore
const restrictions = {
  verifiedOnly: true, includeHaloBikes: false, myBikesOnly: false, owned: {}, ownedWheels: {}, search: ''
} as unknown as RiderInputs

/**
 * The module over a stand-in recommend request whose Applied values the test
 * sets directly - which is the whole of what the module reads from it - and
 * the real composables it wraps. The request itself is tested in
 * `useRecommendRequest.test.ts`.
 */
const SITE = 'https://example.test'

/** A page's own inputs, which may read the live Ride the test moves. */
type PageInputs = (liveRide: Ref<Ride | undefined>) => Partial<RankingPageInputs<RideStatement>>

function setup(pageInputs: PageInputs = () => ({})) {
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
  vi.stubGlobal('shallowRef', shallowRef)
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
    // The route page's: its course is looked up, so the statement follows
    // the live Ride's lap count.
    statement: answer => routeStatement({ route: hilly, laps: liveRide.value?.laps ?? 1, siteUrl: SITE, answer }),
    ...pageInputs(liveRide)
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
    expect(page.answer.value?.text).toMatch(/^ZwiftBikes predicts the Specialized Tarmac SL9 with Shimano C99\/Disc is the best bike and wheels for Watopia Hilly Route in Watopia: /)
    // The lap count is the scope line's to state, once - not the Ride name's as well.
    expect(page.answer.value?.text).toContain('3 laps, including any lead-in once')
    expect(page.answer.value?.text.match(/3 laps/g)).toHaveLength(1)
    expect(page.faqAnswer.value).toBe(page.answer.value?.text)
  })

  it('takes nothing from the page but the Ride, the key and the statement', () => {
    const inputs: Required<RankingPageInputs<RideStatement>> = { ride: () => undefined, key: 'k', statement: () => undefined }
    expect(Object.keys(inputs).sort()).toEqual(['key', 'ride', 'statement'])
  })

  it('sets the statement\'s trail and question in the head, and nothing before the page has a statement', () => {
    const known = ref(false)
    const { page, head } = setup(live => ({
      statement: answer => known.value ? routeStatement({ route: hilly, laps: live.value?.laps ?? 1, siteUrl: SITE, answer }) : undefined
    }))
    expect(head()).toEqual({})
    known.value = true
    const [breadcrumbs, faq] = head().script!
    expect(JSON.parse(breadcrumbs!.innerHTML).itemListElement).toEqual([
      { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': SITE },
      { '@type': 'ListItem', 'position': 2, 'name': 'Watopia Hilly Route', 'item': `${SITE}/routes/hilly-route` }
    ])
    const question = JSON.parse(faq!.innerHTML).mainEntity[0]
    expect(question.name).toBe('What\'s the fastest bike for Watopia Hilly Route?')
    expect(question.acceptedAnswer.text).toBe(page.answer.value?.text)
    expect(page.faqQuestion.value).toBe(question.name)
  })

  it('hands the page its statement, its description naming rank 1 in the category ranked', () => {
    const { page, combos, appliedInputs } = setup()
    appliedInputs.value = { ...appliedInputs.value, category: 'standard' }
    expect(page.statement.value?.description).toBe('The best bike and wheels for Watopia Hilly Route: ZwiftBikes predicts the Specialized Tarmac SL9 with Shimano C99/Disc, fastest on road bikes.')
    combos.value = []
    expect(page.statement.value?.description).toMatch(/ranked by predicted finish time for your weight and power\.$/)
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

  it('plans a TTT over the Applied laps of the route, lead-in once', () => {
    const { page, appliedRide, appliedInputs, combos } = setup()
    combos.value = [zwiftCarbon]
    appliedRide.value = { course: { kind: 'route', slug: 'hilly-route' }, laps: 3 }
    appliedInputs.value = { ...appliedInputs.value, draftMode: 'ttt' }
    // The KOM once a lap, the first just past the 0.5 km lead-in.
    expect(page.tttPlan.value?.sectors.map(sector => [sector.type, sector.fromKm.toFixed(1)])).toEqual([['climb', '1.4'], ['climb', '10.6'], ['climb', '19.8']])
  })

  it('explains the times with the Applied Ride while the live one runs ahead', () => {
    const { page, liveRide } = setup()
    liveRide.value = { course: { kind: 'route', slug: 'hilly-route' }, laps: 3, ...rideRulesForFormat('points') }
    expect(page.appliedLaps.value).toBe(1)
    expect(page.courseAnalysis.value).toMatchObject({ kind: 'route' })
    expect(page.courseAnalysis.value?.ride).toMatchObject({ route: hilly, laps: 1 })
    expect(page.why.value).toMatchObject({ course: hilly, combo: rank1, rideName: 'Watopia Hilly Route', physicsMode: 'dynamic', draftMode: 'solo' })
    expect(page.reportLine.value).toBe('1 lap, 225 W, Solo')
    // The one live reading: the TT chips follow the rule of the Ride being asked for.
    expect(page.hideTtCategory.value).toBe(true)
  })

  it('resolves the Applied Ride once, for the course analysis and the TTT plan alike, until the Applied Ride or course moves', () => {
    const { page, appliedRide, appliedInputs } = setup()
    const resolved = page.courseAnalysis.value?.ride
    expect(resolved).toBeDefined()
    // A rider change re-prices the equipment views, never re-resolves the Ride.
    appliedInputs.value = { ...appliedInputs.value, powerW: 300, draftMode: 'race' }
    expect(page.courseAnalysis.value?.ride).toBe(resolved)
    appliedRide.value = { course: { kind: 'route', slug: 'hilly-route' }, laps: 2 }
    expect(page.courseAnalysis.value?.ride).not.toBe(resolved)
    expect(page.courseAnalysis.value?.ride.laps).toBe(2)
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

  describe('on a segment page', () => {
    const fuego = routeWithMetaForSegment(getSegmentSummary('fuego-flats')!)
    const sprint: Ride = { course: { kind: 'segment', slug: 'fuego-flats' }, power: 'sprint' }

    // The segment page's own inputs: its statement, which says which kind of
    // segment the Ride is and the Race format it was told, if any.
    function segmentSetup(ride: Ride) {
      const page = setup(live => ({
        key: 'recommend-segment-fuego-flats',
        statement: (answer) => {
          const segment = live.value?.course.kind === 'segment' ? getSegmentSummary(live.value.course.slug) : undefined
          return segment && segmentStatement({ segment, course: routeWithMetaForSegment(segment), ride: live.value!, siteUrl: SITE, answer })
        }
      }))
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
      expect(page.courseAnalysis.value).toMatchObject({ kind: 'sprint' })
      expect(page.courseAnalysis.value?.ride).toMatchObject({ route: fuego, laps: 1, timingMeta: { segment: 'fuego-flats' } })
      expect(page.why.value.rideName).toBe('Fuego Flats')
      expect(page.reportLine.value).toBe('Sprint segment, 800 W sprint power, Solo')
    })

    it('states the Race format\'s rules and hides the TT category when a link barred TT frames', () => {
      const { page } = segmentSetup({ ...sprint, ...rideRulesForFormat('rot') })
      expect(page.answer.value?.summary).toMatch(/^WTRL bans TT frames from a Race of Truth\. WTRL turns the draft off for a Race of Truth, so the time is for riding solo\. ZwiftBikes predicts /)
      expect(page.hideTtCategory.value).toBe(true)
      // The Rider card's fixed levers, in the race page's words.
      expect(page.rules.value).toMatchObject({ ttBarredReason: 'WTRL bans TT frames from a Race of Truth.', draftLockedReason: 'WTRL turns the draft off for a Race of Truth.', draftNudge: undefined })
    })

    it('nudges a segment told a mass-start format towards race draft mode, as the race page does', () => {
      const { page, appliedInputs } = segmentSetup({ ...sprint, ...rideRulesForFormat('points') })
      expect(page.rules.value?.draftNudge).toMatchObject({ mode: 'race', text: expect.stringMatching(/^This is a points race, but the ranking below is computed for a lone rider/) })
      appliedInputs.value = { ...appliedInputs.value, draftMode: 'race' }
      expect(page.rules.value?.draftNudge).toBeUndefined()
      expect(segmentSetup(sprint).page.rules.value).toBeUndefined()
    })

    it('plans a TTT on the segment\'s own geometry, the one its times are simulated over', () => {
      const alpe = routeWithMetaForSegment(getSegmentSummary('alpe-du-zwift')!)
      const { page, appliedCourse, appliedInputs, combos } = segmentSetup({ course: { kind: 'segment', slug: 'alpe-du-zwift' } })
      combos.value = [zwiftCarbon]
      appliedInputs.value = { ...appliedInputs.value, powerW: 225, draftMode: 'ttt', tttClimbWkg: 3 }
      // A course record carrying a lead-in the segment is never ridden with:
      // the route-lap builder would move the climb 3 km down the road.
      for (const course of [alpe, { ...alpe, leadInDistance: 3, leadInElevation: 0 }]) {
        appliedCourse.value = course
        const [climb, ...rest] = page.tttPlan.value!.sectors
        expect(rest).toEqual([])
        expect(climb).toMatchObject({ type: 'climb', detail: '12.1 km at 8.5%, est. 1 h 8 min' })
        expect(climb!.fromKm).toBeCloseTo(0.022, 3)
        expect(climb!.toKm).toBeCloseTo(12.134, 3)
      }
    })

    it('keeps the TT category under a format that allows TT frames, and with no format at all', () => {
      expect(segmentSetup({ ...sprint, ...rideRulesForFormat('ttt') }).page.hideTtCategory.value).toBe(false)
      expect(segmentSetup(sprint).page.hideTtCategory.value).toBe(false)
    })
  })
  describe('on a race page', () => {
    // A/B race Makuri 40, C/D Urumaze - a points race, which bars TT frames.
    const race = getRaceBySlug('zrl-2026-27', 'round-1-week-3') as RaceWithFormat
    const season = getSeasonBySlug('zrl-2026-27')!
    const makuri40 = getRouteBySlug('makuri-40')!
    const urumaze = getRouteBySlug('urumaze')!
    const groupRide = (index: number, format = race.format!): Ride => ({
      course: { kind: 'route', slug: race.categories[index]!.routeSlug! },
      laps: race.categories[index]!.laps,
      ...rideRulesForFormat(format)
    })

    // The race page's own inputs: its statement for the group selected, whose
    // name for the course and whose Category group the module keeps for the
    // Applied Ride while the selector runs ahead.
    function raceSetup() {
      const page = setup(live => ({
        key: 'recommend-race-zrl-2026-27-round-1-week-3',
        // The group the live Ride races, as the page's selector would have it.
        statement: () => {
          const groupIndex = Math.max(0, race.categories.findIndex(group => group.routeSlug === live.value?.course.slug))
          const course = live.value && getRouteBySlug(live.value.course.slug)
          return raceStatement({ season, race, groupIndex, course, today: '2026-09-01', siteUrl: SITE })
        }
      }))
      page.liveRide.value = groupRide(0)
      page.appliedRide.value = groupRide(0)
      page.appliedCourse.value = makuri40
      return page
    }

    it('explains the ranking with the Applied Category group while the selector runs ahead to another', () => {
      const { page, liveRide } = raceSetup()
      liveRide.value = groupRide(1)
      expect(page.answer.value?.text).toMatch(/^Zwift disables TT frames for points races\. ZwiftBikes predicts the Specialized Tarmac SL9 with Shimano C99\/Disc is the best bike and wheels for Makuri 40 in Makuri Islands: /)
      // 40.252 km - the lap and the lead-in once - in 25:00.
      expect(page.answer.value?.text).toContain('finishing in 25:00 (~96.6 km/h)')
      // The Category group's lap count, once, in the scope line.
      expect(page.answer.value?.text.match(/\b1 lap\b/g)).toEqual(['1 lap'])
      expect(page.answer.value?.text).toContain('1 lap, including any lead-in once')
      expect(page.courseAnalysis.value).toMatchObject({ kind: 'route', ride: { route: makuri40, laps: 1 } })
      expect(page.reportLine.value).toBe('A/B, ridden as a points race, 1 lap, 225 W, Solo, TT frames barred')
      expect(page.hideTtCategory.value).toBe(true)
    })

    it('names the group the selector moved to once its ranking has landed', () => {
      const { page, liveRide, appliedRide, appliedCourse } = raceSetup()
      liveRide.value = groupRide(1)
      appliedRide.value = groupRide(1)
      appliedCourse.value = urumaze
      expect(page.answer.value?.text).toContain('for Urumaze in Makuri Islands: ')
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
