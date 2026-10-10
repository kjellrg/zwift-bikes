import { describe, expect, it } from 'vitest'
import { getFrames, getRouteBySlug, getRoutesWithMeta } from './catalog'
import type { RecommendRide } from '../types/recommendRide'
import { courseCoverage } from './courseCoverage'
import { firstLapOfRide, rideForRoute, rideForSegment } from './recommendRide'
import { getAllSegmentSummaries, getSegmentSummary, routeWithMetaForSegment } from './routeSegments'
import { resolveDraft, simulateRoute } from './physics'
import { geometryForRouteLaps } from './physics/routeGeometry'
import { maxLapsForRoute } from './routeLaps'
import { getWheelsets } from './wheelsets'

describe('rideForRoute', () => {
  it('clamps laps before exposing the ride and its timing metadata', () => {
    const route = { ...getRouteBySlug('tempus-fugit')!, lap: true, distance: 10, leadInDistance: 0 }
    for (const [requested, expected] of [[undefined, 1], [0, 1], [2.8, 3], [100, 15]] as const) {
      const ride = rideForRoute(route, requested, true)
      expect(ride.laps).toBe(expected)
      expect(ride.timingMeta.laps).toBe(expected)
      expect(ride.excludeTT).toBe(true)
    }
    expect(rideForRoute({ ...route, lap: false }, 3).laps).toBe(1)
    expect(rideForRoute({ ...route, distance: 60, leadInDistance: 30 }, 15).laps).toBe(2)
    expect(rideForRoute(route, Number.NaN).laps).toBe(1)
    expect(rideForRoute(route, Number.POSITIVE_INFINITY).laps).toBe(1)
  })

  it('rides the route\'s laps geometry, lead-in once, for every route and every lap count it allows', () => {
    // What the TTT plan was built from before it read the Ride (issue #284):
    // route and race pages' plans stay as they were only while this holds.
    for (const route of getRoutesWithMeta()) {
      for (let laps = 1; laps <= maxLapsForRoute(route); laps++) {
        expect(rideForRoute(route, laps).planGeometry(), `${route.slug} x${laps}`).toEqual(geometryForRouteLaps(route, laps))
      }
    }
  })

  const rider = { weightKg: 75, heightCm: 175, powerW: 225 }
  const carbon = () => ({
    frame: getFrames().find(frame => frame.name === 'Zwift Carbon')!,
    wheelset: getWheelsets().find(wheelset => wheelset.name === 'Zwift 32mm Carbon')!
  })

  it('times every pass of a named climb - lead-in and each lap - inside the one simulation that times the finish', () => {
    // Lutscher rides the Innsbruck KOM once in its lead-in and once per lap.
    const ride = rideForRoute(getRouteBySlug('lutscher')!, 2)
    expect(ride.climbs.map(climb => [climb.slug, climb.lapNumber])).toEqual([
      ['innsbruck-kom', undefined],
      ['innsbruck-kom', 1],
      ['innsbruck-kom', 2]
    ])
    const calls: Parameters<typeof simulateRoute>[0][] = []
    const recordingSimulate: typeof simulateRoute = (options) => {
      calls.push(options)
      return simulateRoute(options)
    }
    const draft = resolveDraft({ mode: 'race' }, ride.planGeometry(), rider)
    const timing = ride.prepare(recordingSimulate, rider).timeCombo!({ ...carbon(), draft })
    expect(calls).toHaveLength(1)
    expect(timing.climbSec).toHaveLength(3)
    // The same 7.4 km at 6%, ridden three times by one rider: about 25
    // minutes each, and the laps within a few seconds of each other.
    for (const seconds of timing.climbSec) expect(seconds).toBeGreaterThan(20 * 60)
    for (const seconds of timing.climbSec) expect(seconds).toBeLessThan(32 * 60)
    expect(Math.abs(timing.climbSec[1]! - timing.climbSec[2]!)).toBeLessThan(5)
  })

  it('leaves the finish time exactly as it is without the climb boundaries', () => {
    for (const [slug, laps] of [['lutscher', 2], ['innsbruck-kom-after-party', 1], ['road-to-sky', 1]] as const) {
      const ride = rideForRoute(getRouteBySlug(slug)!, laps)
      const draft = resolveDraft({ mode: 'race' }, ride.planGeometry(), rider)
      const timing = ride.prepare(simulateRoute, rider).timeCombo!({ ...carbon(), draft })
      const plain = simulateRoute({ rider, ...carbon(), geometry: ride.planGeometry(), powerSegmentsW: draft.plan?.powerSegmentsW, powerScaleAtSpeed: draft.powerScaleAtSpeed })
      expect(timing.finishSec).toBe(plain.elapsedSec)
    }
  })

  it('times a climb that runs to the line, and one that straddles a lap boundary', () => {
    const base = getRouteBySlug('innsbruck-kom-after-party')!
    const kom = base.terrain.climbs[0]!
    // The same road, reshaped so the KOM starts in one lap and ends in the next.
    const straddling = { ...base, lap: true, terrain: { ...base.terrain, climbs: [{ ...kom, fromKm: base.distance - 1, toKm: base.distance + 0.5, lengthKm: 1.5 }] } }
    const ride = rideForRoute(straddling, 2)
    const draft = resolveDraft({ mode: 'solo' }, ride.planGeometry(), rider)
    const timing = ride.prepare(simulateRoute, rider).timeCombo!({ ...carbon(), draft })
    expect(ride.climbs).toHaveLength(2)
    // Lap 1's pass crosses into lap 2; lap 2's is cut at the finish, 1 km long.
    expect(timing.climbSec[0]).toBeGreaterThan(timing.climbSec[1]!)
    expect(timing.climbSec[1]).toBeGreaterThan(0)

    const toTheLine = rideForRoute(base, 1)
    const whole = toTheLine.prepare(simulateRoute, rider).timeCombo!({ ...carbon(), draft: resolveDraft({ mode: 'solo' }, toTheLine.planGeometry(), rider) })
    expect(whole.climbSec).toHaveLength(1)
    expect(whole.climbSec[0]).toBeGreaterThan(20 * 60)
    expect(whole.climbSec[0]).toBeLessThan(whole.finishSec)
  })
})

describe('rideForSegment', () => {
  it('carries the TT-frame bar, so a segment ridden under a race format is ranked under it', () => {
    const route = routeWithMetaForSegment(getSegmentSummary('alpe-du-zwift')!)
    expect(rideForSegment(route).excludeTT).toBe(false)
    expect(rideForSegment(route, true).excludeTT).toBe(true)
  })

  it('times the exposed geometry and plan from the warm-up exit speed', () => {
    const route = routeWithMetaForSegment(getSegmentSummary('alpe-du-zwift')!)
    const ride = rideForSegment(route, false, 3000)
    const rider = { weightKg: 75, heightCm: 175, powerW: 225 }
    const geometry = ride.planGeometry()
    const draft = resolveDraft({ mode: 'ttt', riders: 6, climbWkg: 3.5 }, geometry, rider)
    expect(draft.plan).toBeDefined()
    const calls: { options: Parameters<typeof simulateRoute>[0], result: ReturnType<typeof simulateRoute> }[] = []
    const recordingSimulate: typeof simulateRoute = (options) => {
      const result = simulateRoute(options)
      calls.push({ options, result })
      return result
    }
    const timing = ride.prepare(recordingSimulate, rider).timeCombo!({
      frame: getFrames().find(frame => frame.name === 'Zwift Carbon')!,
      wheelset: getWheelsets().find(wheelset => wheelset.name === 'Zwift 32mm Carbon')!,
      draft
    })
    expect(calls).toHaveLength(2)
    const [warmup, timed] = calls
    // The warm-up is drafted but never paced: its plan is in the timed run's
    // coordinates, and only the exit speed carries over.
    expect(warmup!.options.geometry.totalDistanceM).toBe(3000)
    expect(warmup!.options.powerSegmentsW).toBeUndefined()
    expect(warmup!.options.powerScaleAtSpeed).toBe(draft.powerScaleAtSpeed)
    expect(warmup!.result.finalSpeedMps).toBeGreaterThan(0)
    expect(timed!.options.initialSpeedMps).toBe(warmup!.result.finalSpeedMps)
    expect(timed!.options.geometry).toBe(geometry)
    expect(timed!.options.powerSegmentsW).toBe(draft.plan!.powerSegmentsW)
    expect(timed!.options.powerScaleAtSpeed).toBe(draft.powerScaleAtSpeed)
    expect(timing).toEqual({ finishSec: timed!.result.elapsedSec, climbSec: [] })
  })

  it.each(['alley-sprint', 'alpe-du-zwift', 'the-clyde-kicker', '23rd-st'])('keeps %s timing invariant to warm-up distance within 0.1 seconds', (slug) => {
    const route = routeWithMetaForSegment(getSegmentSummary(slug)!)
    const rider = { weightKg: 75, heightCm: 175, powerW: slug === 'alley-sprint' ? 1000 : 225 }
    const frame = getFrames().find(frame => frame.name === 'Zwift Carbon')!
    const wheelset = getWheelsets().find(wheelset => wheelset.name === 'Zwift 32mm Carbon')!
    expect(frame).toBeDefined()
    expect(wheelset).toBeDefined()
    for (const setting of [{ mode: 'solo' as const }, { mode: 'ttt' as const, riders: 6, climbWkg: 3.5 }]) {
      const times = [2000, 3000, 4000].map((warmup) => {
        const ride = rideForSegment(route, false, warmup)
        return ride.prepare(simulateRoute, rider).timeCombo!({
          frame,
          wheelset,
          draft: resolveDraft(setting, ride.planGeometry(), rider)
        }).finishSec
      })
      expect(Math.max(...times) - Math.min(...times)).toBeLessThan(0.1)
    }
  })

  it('keeps the same measured plan geometry in legacy and dynamic modes', () => {
    const route = routeWithMetaForSegment(getSegmentSummary('alpe-du-zwift')!)
    const ride = rideForSegment(route)
    const geometry = ride.planGeometry()
    expect(geometry.points.length).toBeGreaterThan(2)
    expect(ride.prepare(simulateRoute)).toEqual({})
    expect(ride.planGeometry()).toBe(geometry)
    expect(ride.prepare(simulateRoute, { weightKg: 75, heightCm: 175, powerW: 225 }).timeCombo).toBeTypeOf('function')
    expect(ride.planGeometry()).toBe(geometry)
  })
})

/**
 * The resolved Ride is the one way in to a course's geometry (issue #319):
 * the Course hero draws `planGeometry`'s own points, and the speed chart
 * rides that geometry under the draft the ranking resolves on it.
 */
describe('one geometry per Ride', () => {
  const rider = { weightKg: 75, heightCm: 175, powerW: 225 }
  const setup = {
    frame: getFrames().find(frame => frame.name === 'Zwift Carbon')!,
    wheelset: getWheelsets().find(wheelset => wheelset.name === 'Zwift 32mm Carbon')!
  }
  const ttt = { mode: 'ttt' as const, riders: 6, climbWkg: 3.5 }

  function recording() {
    const calls: { options: Parameters<typeof simulateRoute>[0], result: ReturnType<typeof simulateRoute> }[] = []
    const simulate: typeof simulateRoute = (options) => {
      const result = simulateRoute(options)
      calls.push({ options, result })
      return result
    }
    return { calls, simulate }
  }

  /** The hero's points as the geometry they were drawn from. */
  const drawn = (ride: RecommendRide) => ride.profile()!.points.map(({ distanceM, elevationM }) => ({ distanceM, elevationM }))

  describe('on a route, two laps with a lead-in', () => {
    // Lutscher: a 10.8 km lead-in carrying the Innsbruck KOM, then the KOM once a lap.
    const ride = rideForRoute(getRouteBySlug('lutscher')!, 2)

    it('draws the Course hero from the Ride\'s planGeometry points, its bands from the Ride\'s passes and its lap starts from the geometry', () => {
      const geometry = geometryForRouteLaps(ride.route, 2)
      expect(drawn(ride)).toEqual(ride.planGeometry().points)
      expect(ride.profile()!.climbs.map(band => band.slug)).toEqual(ride.climbs.map(climb => climb.slug))
      expect(ride.profile()!.sprints).toHaveLength(ride.sprints.length)
      expect(ride.profile()!.lapStarts).toEqual([geometry.lapStartsM[1]! / geometry.totalDistanceM])
      // Memoised: one profile per Ride and sample count.
      expect(ride.profile()).toBe(ride.profile())
    })

    it('charts one pass of the lap with the lead-in, cut out of planGeometry, under the ranking\'s draft', () => {
      const { calls, simulate } = recording()
      const profile = ride.speedProfile(setup, rider, ttt, simulate)
      expect(profile).toBeDefined()
      // The draft and its TTT plan are resolved on the whole Ride, as the ranking resolves them.
      const ranking = resolveDraft(ttt, ride.planGeometry(), rider)
      expect(ranking.plan).toBeDefined()
      const [chart, solo] = calls
      expect(calls).toHaveLength(2)
      expect(chart!.options.powerSegmentsW).toEqual(ranking.plan!.powerSegmentsW)
      expect(chart!.options.powerScaleAtSpeed!(10)).toBe(ranking.powerScaleAtSpeed!(10))
      expect(solo!.options.powerSegmentsW).toEqual(ranking.solo.plan!.powerSegmentsW)
      // The lead-in and the first lap, every point the ranking rides there.
      const lapEndM = geometryForRouteLaps(ride.route, 2).lapStartsM[1]!
      expect(chart!.options.geometry.totalDistanceM).toBe(lapEndM)
      expect(chart!.options.geometry.points).toEqual(ride.planGeometry().points.filter(point => point.distanceM <= lapEndM + 1e-6))
      expect(chart!.options.initialSpeedMps).toBeUndefined()
      // Memoised per setup, rider and draft: asking again simulates nothing.
      expect(ride.speedProfile(setup, rider, ttt, simulate)).toBe(profile)
      expect(calls).toHaveLength(2)
      expect(ride.speedProfile(setup, { ...rider, powerW: 250 }, ttt, simulate)).not.toBe(profile)
    })
  })

  describe('on a segment', () => {
    const ride = rideForSegment(routeWithMetaForSegment(getSegmentSummary('alpe-du-zwift')!))

    it('draws the Course hero from the segment\'s own planGeometry points, with nothing named on it', () => {
      expect(drawn(ride)).toEqual(ride.planGeometry().points)
      expect(ride.profile()).toMatchObject({ climbs: [], sprints: [], lapStarts: [] })
      expect(ride.profile()).not.toHaveProperty('approximatedUntil')
    })

    it('charts the timed estimate: the segment\'s own geometry entered off the warm-up, under the ranking\'s draft', () => {
      const { calls, simulate } = recording()
      expect(ride.speedProfile(setup, rider, ttt, simulate)).toBeDefined()
      const ranking = resolveDraft(ttt, ride.planGeometry(), rider)
      const [warmup, soloWarmup, chart, solo] = calls
      expect(calls).toHaveLength(4)
      expect(chart!.options.geometry).toBe(ride.planGeometry())
      expect(chart!.options.initialSpeedMps).toBe(warmup!.result.finalSpeedMps)
      expect(chart!.options.powerSegmentsW).toEqual(ranking.plan!.powerSegmentsW)
      expect(chart!.options.powerScaleAtSpeed!(10)).toBe(ranking.powerScaleAtSpeed!(10))
      // The solo line enters off a solo warm-up.
      expect(soloWarmup!.options.powerScaleAtSpeed).toBeUndefined()
      expect(solo!.options.initialSpeedMps).toBe(soloWarmup!.result.finalSpeedMps)

      // The very time the ranking gives this setup.
      const timed = recording()
      const timing = ride.prepare(timed.simulate, rider).timeCombo!({ ...setup, draft: ranking })
      expect(timed.calls[0]!.options).toMatchObject({ geometry: warmup!.options.geometry, steadyStateToleranceMps2: warmup!.options.steadyStateToleranceMps2 })
      expect(timed.calls[1]!.options.initialSpeedMps).toBe(chart!.options.initialSpeedMps)
      expect(chart!.result.elapsedSec).toBeCloseTo(timing.finishSec, 6)
    })
  })

  it('cuts the first pass out of the Ride\'s geometry exactly where a one-lap Ride ends, on every route', () => {
    for (const route of getRoutesWithMeta()) {
      const laps = maxLapsForRoute(route)
      const { lapStartsM: _, ...oneLap } = geometryForRouteLaps(route, 1)
      expect(firstLapOfRide(geometryForRouteLaps(route, laps)), `${route.slug} x${laps}`).toEqual(oneLap)
    }
  })

  it('reads the coverage rule, on every route and segment in the catalog', () => {
    const rides = [
      ...getRoutesWithMeta().map(route => rideForRoute(route, 1)),
      ...getAllSegmentSummaries().map(segment => rideForSegment(routeWithMetaForSegment(segment)))
    ]
    for (const ride of rides) {
      expect(ride.coverage, ride.route.slug).toEqual(courseCoverage(ride.route))
      expect(ride.profile() !== undefined, ride.route.slug).toBe(ride.coverage.measuredLap)
    }
  })
})
