import { describe, expect, it } from 'vitest'
import { getRouteBySlug } from '#shared/utils/catalog'
import type { ComboScore } from '../../shared/types/catalog'
import { rankingPageAnalysisKind, rankingPageAnswerRide, rankingPageHasLongClimb, rankingPageReportLine, rankingPageShareCard } from './rankingPage'

// Real catalog courses: the long-climb check reads the geometry the server
// times, and a hand-built route would only test the fixture.
const alpe = getRouteBySlug('road-to-sky')!
const flat = getRouteBySlug('tempus-fugit')!
const rider = { weightKg: 75, powerW: 225 }

describe('rankingPageHasLongClimb', () => {
  it('finds the long climb on a route that has one, for the Applied rider', () => {
    expect(rankingPageHasLongClimb({ course: { kind: 'route', slug: alpe.slug }, laps: 1 }, alpe, rider)).toBe(true)
  })

  it('finds none on a flat route', () => {
    expect(rankingPageHasLongClimb({ course: { kind: 'route', slug: flat.slug }, laps: 1 }, flat, rider)).toBe(false)
  })

  it('keeps the lever while the Applied course is not known yet', () => {
    expect(rankingPageHasLongClimb({ course: { kind: 'route', slug: 'somewhere' }, laps: 1 }, undefined, rider)).toBe(true)
    expect(rankingPageHasLongClimb(undefined, undefined, rider)).toBe(true)
  })
})

describe('rankingPageAnswerRide', () => {
  const hilly = getRouteBySlug('hilly-route')!
  const name = (course: { name: string, worldName: string }, laps: number) => `${laps} x ${course.name} in ${course.worldName}`

  it('names the Applied course for the Applied laps, and times its distance with the lead-in once', () => {
    const answer = rankingPageAnswerRide({ course: { kind: 'route', slug: 'hilly-route' }, laps: 3 }, hilly, name)
    expect(answer).toEqual({ rideName: '3 x Watopia Hilly Route in Watopia', distanceKm: expect.closeTo(0.502 + 3 * 9.193, 6), laps: 3, rideRules: undefined })
  })

  it('states no lap count for a segment, and times the segment\'s own length', () => {
    const segment = { ...flat, slug: 'a-segment', distance: 1.4, leadInDistance: undefined, lap: false }
    const answer = rankingPageAnswerRide({ course: { kind: 'segment', slug: 'a-segment' }, power: 'sprint' }, segment, name)
    expect(answer).toEqual({ rideName: `1 x ${flat.name} in ${flat.worldName}`, distanceKm: 1.4, laps: undefined, rideRules: undefined })
  })

  it('leads with the Race format rules line of the Applied Ride', () => {
    const answer = rankingPageAnswerRide({ course: { kind: 'route', slug: 'hilly-route' }, laps: 1, raceFormat: 'rot', ttFramesAllowed: false, draftingAllowed: false }, hilly, name)
    expect(answer?.rideRules).toMatch(/^WTRL bans TT bikes from its Race of Truth/)
  })

  it('says nothing until the Applied course is known', () => {
    expect(rankingPageAnswerRide({ course: { kind: 'route', slug: 'hilly-route' }, laps: 1 }, undefined, name)).toBeUndefined()
  })
})

describe('rankingPageReportLine', () => {
  const rider = { powerW: 250, draftMode: 'solo' as const, tttRiders: 4 }

  it('says what the Applied Ride was ridden as, with no subject where the URL says it', () => {
    expect(rankingPageReportLine({ course: { kind: 'route', slug: 'hilly-route' }, laps: 3 }, rider)).toBe('3 laps, 250 W, Solo')
  })

  it('leads with the page\'s subject, worked out from the Applied Ride', () => {
    const subject = (ride: { power?: string } | undefined) => ride?.power === 'sprint' ? 'Sprint segment' : 'Climbing segment'
    expect(rankingPageReportLine({ course: { kind: 'segment', slug: 'a-sprint' }, power: 'sprint' }, { ...rider, powerW: 800 }, subject))
      .toBe('Sprint segment, 800 W sprint power, Solo')
  })
})

describe('rankingPageShareCard', () => {
  const hilly = getRouteBySlug('hilly-route')!
  const rank1 = { frame: { name: 'Specialized Tarmac SL9' }, wheelset: { name: 'Shimano C99/Disc' } } as ComboScore

  it('names rank 1\'s frame and wheels, and draws the Applied course at the share card\'s finer count', () => {
    const card = rankingPageShareCard(rank1, hilly, 1)
    expect(card.frameName).toBe('Specialized Tarmac SL9')
    expect(card.wheelName).toBe('Shimano C99/Disc')
    expect(card.silhouette?.heights).toHaveLength(120)
  })

  it('still draws the course when nothing is ranked', () => {
    const card = rankingPageShareCard(undefined, hilly, 1)
    expect(card).toMatchObject({ frameName: undefined, wheelName: undefined })
    expect(card.silhouette?.heights).toHaveLength(120)
  })

  it('names no wheels for a frame ridden on its own', () => {
    const fixed = { frame: { name: 'Zwift Buffalo Fat Tire' } } as ComboScore
    expect(rankingPageShareCard(fixed, hilly, 1).wheelName).toBeUndefined()
  })

  it('draws no Silhouette for a course with no measured profile, or no course', () => {
    const unmeasured = { ...hilly, terrain: { ...hilly.terrain, elevationProfile: [] } }
    expect(rankingPageShareCard(rank1, unmeasured, 1).silhouette).toBeUndefined()
    expect(rankingPageShareCard(rank1, undefined, 1).silhouette).toBeUndefined()
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
