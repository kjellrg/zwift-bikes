import { describe, expect, it } from 'vitest'
import { getRouteBySlug } from '#shared/utils/catalog'
import { getRaceBySlug, type EventRace } from '#shared/utils/events'
import { rideForRoute, rideForSegment } from '#shared/utils/recommendRide'
import { getSegmentSummary, routeWithMetaForSegment } from '#shared/utils/routeSegments'
import type { ComboScore } from '../../shared/types/catalog'
import { rankingPageAnalysisKind, rankingPageAnswerRide, rankingPageHasLongClimb, rankingPageLaps, rankingPageReportLine, rankingPageShareCard, resolveRankingPageRide } from './rankingPage'
import { rideRulesForFormat, type Ride } from './recommendRequest'

// Real catalog courses: the long-climb check reads the geometry the server
// times, and a hand-built route would only test the fixture.
const alpe = getRouteBySlug('road-to-sky')!
const flat = getRouteBySlug('tempus-fugit')!
const rider = { weightKg: 75, powerW: 225 }

describe('rankingPageHasLongClimb', () => {
  it('finds the long climb on a route that has one, for the Applied rider', () => {
    expect(rankingPageHasLongClimb(resolveRankingPageRide({ course: { kind: 'route', slug: alpe.slug }, laps: 1 }, alpe), rider)).toBe(true)
  })

  it('finds none on a flat route', () => {
    expect(rankingPageHasLongClimb(resolveRankingPageRide({ course: { kind: 'route', slug: flat.slug }, laps: 1 }, flat), rider)).toBe(false)
  })

  it('keeps the lever while the Applied course is not known yet', () => {
    expect(rankingPageHasLongClimb(resolveRankingPageRide({ course: { kind: 'route', slug: 'somewhere' }, laps: 1 }, undefined), rider)).toBe(true)
    expect(rankingPageHasLongClimb(undefined, rider)).toBe(true)
  })
})

describe('rankingPageAnswerRide', () => {
  const hilly = getRouteBySlug('hilly-route')!
  it('names the Applied course, and times the Applied laps with the lead-in once', () => {
    const answer = rankingPageAnswerRide({ course: { kind: 'route', slug: 'hilly-route' }, laps: 3 }, hilly, 'Watopia Hilly Route in Watopia')
    expect(answer).toEqual({ rideName: 'Watopia Hilly Route in Watopia', distanceKm: expect.closeTo(0.502 + 3 * 9.193, 6), laps: 3, rideRules: undefined })
  })

  it('states no lap count for a segment, and times the segment\'s own length', () => {
    const segment = { ...flat, slug: 'a-segment', distance: 1.4, leadInDistance: undefined, lap: false }
    const answer = rankingPageAnswerRide({ course: { kind: 'segment', slug: 'a-segment' }, power: 'sprint' }, segment, `${flat.name} in ${flat.worldName}`)
    expect(answer).toEqual({ rideName: `${flat.name} in ${flat.worldName}`, distanceKm: 1.4, laps: undefined, rideRules: undefined })
  })

  it('leads with the Race format rules line of the Applied Ride', () => {
    const answer = rankingPageAnswerRide({ course: { kind: 'route', slug: 'hilly-route' }, laps: 1, raceFormat: 'rot', ttFramesAllowed: false, draftingAllowed: false }, hilly, 'Watopia Hilly Route in Watopia')
    expect(answer?.rideRules).toMatch(/^WTRL bans TT frames from a Race of Truth\./)
  })

  it('says nothing until the Applied course and its name are known', () => {
    expect(rankingPageAnswerRide({ course: { kind: 'route', slug: 'hilly-route' }, laps: 1 }, undefined, 'Watopia Hilly Route in Watopia')).toBeUndefined()
    expect(rankingPageAnswerRide({ course: { kind: 'route', slug: 'hilly-route' }, laps: 1 }, hilly, undefined)).toBeUndefined()
  })
})

describe('rankingPageReportLine', () => {
  const rider = { powerW: 250, draftMode: 'solo' as const, tttRiders: 4 }

  it('says what the Applied Ride was ridden as, with no subject where the URL says it', () => {
    expect(rankingPageReportLine({ course: { kind: 'route', slug: 'hilly-route' }, laps: 3 }, rider)).toBe('3 laps, 250 W, Solo')
  })

  it('leads with the subject the Ride statement gave the Applied Ride', () => {
    expect(rankingPageReportLine({ course: { kind: 'segment', slug: 'a-sprint' }, power: 'sprint' }, { ...rider, powerW: 800 }, 'Sprint segment'))
      .toBe('Sprint segment, 800 W sprint power, Solo')
  })
})

describe('rankingPageShareCard', () => {
  const hilly = getRouteBySlug('hilly-route')!
  const rank1 = { frame: { name: 'Specialized Tarmac SL9' }, wheelset: { name: 'Shimano C99/Disc' } } as ComboScore

  it('names rank 1\'s frame and wheels, and draws the Applied course at the share card\'s finer count', () => {
    const card = rankingPageShareCard(rank1, rideForRoute(hilly, 1))
    expect(card.frameName).toBe('Specialized Tarmac SL9')
    expect(card.wheelName).toBe('Shimano C99/Disc')
    expect(card.silhouette?.heights).toHaveLength(120)
  })

  it('still draws the course when nothing is ranked', () => {
    const card = rankingPageShareCard(undefined, rideForRoute(hilly, 1))
    expect(card).toMatchObject({ frameName: undefined, wheelName: undefined })
    expect(card.silhouette?.heights).toHaveLength(120)
  })

  it('names no wheels for a frame ridden on its own', () => {
    const fixed = { frame: { name: 'Zwift Buffalo Fat Tire' } } as ComboScore
    expect(rankingPageShareCard(fixed, rideForRoute(hilly, 1)).wheelName).toBeUndefined()
  })

  it('draws no Silhouette for a course with no measured profile, or no course', () => {
    const unmeasured = { ...hilly, terrain: { ...hilly.terrain, elevationProfile: [] } }
    expect(rankingPageShareCard(rank1, rideForRoute(unmeasured, 1)).silhouette).toBeUndefined()
    expect(rankingPageShareCard(rank1, undefined).silhouette).toBeUndefined()
  })
})

describe('rankingPageAnalysisKind', () => {
  it('reads what the Applied Ride is: a route, a climb or a sprint', () => {
    expect(rankingPageAnalysisKind({ course: { kind: 'route', slug: 'hilly-route' }, laps: 2 })).toBe('route')
    expect(rankingPageAnalysisKind({ course: { kind: 'segment', slug: 'alpe-du-zwift' }, power: 'race' })).toBe('climb')
    expect(rankingPageAnalysisKind({ course: { kind: 'segment', slug: 'fuego-flats' }, power: 'sprint' })).toBe('sprint')
    expect(rankingPageAnalysisKind(undefined)).toBe('route')
  })
})

/**
 * The segment page's inputs, over real segment courses - the segment-as-route
 * the server ranks against (`routeWithMetaForSegment`), as the Applied
 * Ranking's course carries it.
 */
describe('a segment\'s Ranking page', () => {
  const segmentCourse = (slug: string) => routeWithMetaForSegment(getSegmentSummary(slug)!)
  const alpe = segmentCourse('alpe-du-zwift')
  const fuego = segmentCourse('fuego-flats')
  // A membership segment: no position on any host, so no measured profile.
  const acropolis = segmentCourse('acropolis-sprint')
  const climb: Ride = { course: { kind: 'segment', slug: 'alpe-du-zwift' }, power: 'race' }
  const sprint: Ride = { course: { kind: 'segment', slug: 'fuego-flats' }, power: 'sprint' }

  it('is ridden once', () => {
    expect(rankingPageLaps(climb)).toBe(1)
    expect(rankingPageLaps(sprint)).toBe(1)
  })

  it('answers for one pass of the segment, timed over the segment\'s own length, with no lap count', () => {
    expect(rankingPageAnswerRide(climb, alpe, 'the Alpe du Zwift climb in Watopia')).toEqual({
      rideName: 'the Alpe du Zwift climb in Watopia',
      distanceKm: expect.closeTo(12.228, 6),
      laps: undefined,
      rideRules: undefined
    })
    expect(rankingPageAnswerRide(sprint, fuego, 'the Fuego Flats sprint in Watopia')).toMatchObject({
      rideName: 'the Fuego Flats sprint in Watopia',
      distanceKm: expect.closeTo(0.498, 6),
      laps: undefined
    })
  })

  it('leads the answer with the Race format rules line when a link supplied a format', () => {
    const answer = rankingPageAnswerRide({ ...sprint, ...rideRulesForFormat('rot') }, fuego, 'the Fuego Flats sprint in Watopia')
    expect(answer?.rideRules).toMatch(/^WTRL bans TT frames from a Race of Truth\./)
  })

  it('analyses a climb with its speed chart and a sprint without', () => {
    expect(rankingPageAnalysisKind(climb)).toBe('climb')
    expect(rankingPageAnalysisKind(sprint)).toBe('sprint')
  })

  it('finds the long climb on the segment itself, at the power it was ridden at', () => {
    expect(rankingPageHasLongClimb(resolveRankingPageRide(climb, alpe), rider)).toBe(true)
    expect(rankingPageHasLongClimb(resolveRankingPageRide(sprint, fuego), { weightKg: 75, powerW: 800 })).toBe(false)
  })

  it('carries a Silhouette on the share card only when the segment has a measured profile', () => {
    const rank1 = { frame: { name: 'Specialized Tarmac SL9' }, wheelset: { name: 'Shimano C99/Disc' } } as ComboScore
    expect(rankingPageShareCard(rank1, rideForSegment(alpe)).silhouette?.heights).toHaveLength(120)
    // A positional sprint's measured slice may be two points, and still counts.
    expect(rankingPageShareCard(rank1, rideForSegment(fuego)).silhouette?.heights).toHaveLength(120)
    expect(rankingPageShareCard(rank1, rideForSegment(acropolis))).toEqual({ frameName: 'Specialized Tarmac SL9', wheelName: 'Shimano C99/Disc', silhouette: undefined })
  })
})

/**
 * The race page's inputs, over real races and the catalog routes their
 * Category groups race: a Ride per group, its laps the group's and its rules
 * the Race format's, and the page's own words for it.
 */
describe('a race\'s Ranking page', () => {
  // Same route, different laps: A/B 4 laps of Innsbruckring, C/D 3.
  const byLaps = getRaceBySlug('zrl-2026-27', 'round-1-week-2')!
  // Different routes: A/B on Makuri 40, C/D on Urumaze. A points race.
  const byRoute = getRaceBySlug('zrl-2026-27', 'round-1-week-3')!
  // A Race of Truth: no TT frames, no draft.
  const rot = getRaceBySlug('zrl-2026-27', 'round-1-week-1')!
  const innsbruckring = getRouteBySlug('innsbruckring')!
  const makuri40 = getRouteBySlug('makuri-40')!
  const groupRide = (race: EventRace, index: number): Ride => ({
    course: { kind: 'route', slug: race.categories[index]!.routeSlug! },
    laps: race.categories[index]!.laps,
    ...rideRulesForFormat(race.format!)
  })

  it('rides the Applied Category group\'s laps', () => {
    expect(rankingPageLaps(groupRide(byLaps, 0))).toBe(4)
    expect(rankingPageLaps(groupRide(byLaps, 1))).toBe(3)
  })

  it('answers for the Applied course over the Applied laps, timed with the lead-in once, under the Race format\'s rules', () => {
    expect(rankingPageAnswerRide(groupRide(byLaps, 1), innsbruckring, 'Innsbruckring in Innsbruck')).toEqual({
      rideName: 'Innsbruckring in Innsbruck',
      distanceKm: expect.closeTo(0.222 + 3 * 8.799, 6),
      laps: 3,
      rideRules: 'Zwift disables TT frames for scratch races.'
    })
  })

  it('times the course the Applied Ranking was computed over, under the format\'s rules', () => {
    expect(rankingPageAnswerRide(groupRide(byRoute, 0), makuri40, 'Makuri 40 in Makuri Islands')).toMatchObject({
      rideName: 'Makuri 40 in Makuri Islands',
      distanceKm: expect.closeTo(0.137 + 40.115, 6),
      rideRules: 'Zwift disables TT frames for points races.'
    })
  })

  it('bars TT frames from the Ride under a format that bars them, and ranks a TTT with them', () => {
    expect(resolveRankingPageRide(groupRide(byRoute, 0), makuri40)?.excludeTT).toBe(true)
    expect(resolveRankingPageRide(groupRide(rot, 0), getRouteBySlug('montmartre-mixer')!)?.excludeTT).toBe(true)
    const ttt = { ...groupRide(byLaps, 0), ...rideRulesForFormat('ttt') }
    expect(resolveRankingPageRide(ttt, innsbruckring)?.excludeTT).toBe(false)
  })

  it('leads the Race of Truth\'s answer with its rules line', () => {
    expect(rankingPageAnswerRide(groupRide(rot, 0), getRouteBySlug('montmartre-mixer')!, 'Montmartre Mixer in Paris')?.rideRules)
      .toBe('WTRL bans TT frames from a Race of Truth. WTRL turns the draft off for a Race of Truth, so the time is for riding solo.')
  })

  it('leads the report line with the Applied Category group', () => {
    const rider = { powerW: 250, draftMode: 'race' as const, tttRiders: 4 }
    expect(rankingPageReportLine(groupRide(byLaps, 1), rider, 'C/D')).toBe('C/D, ridden as a scratch race, 3 laps, 250 W, Race draft, TT frames barred')
  })

  it('draws the Applied group\'s course on the share card, for its laps', () => {
    const rank1 = { frame: { name: 'Specialized Tarmac SL9' }, wheelset: { name: 'Shimano C99/Disc' } } as ComboScore
    const card = rankingPageShareCard(rank1, rideForRoute(innsbruckring, 4))
    expect(card).toMatchObject({ frameName: 'Specialized Tarmac SL9', wheelName: 'Shimano C99/Disc' })
    expect(card.silhouette?.heights).toHaveLength(120)
    expect(card.silhouette).not.toEqual(rankingPageShareCard(rank1, rideForRoute(innsbruckring, 1)).silhouette)
  })
})
