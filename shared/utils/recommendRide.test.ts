import { describe, expect, it } from 'vitest'
import { getFrames, getRouteBySlug } from './catalog'
import { rideForRoute, rideForSegment } from './recommendRide'
import { getSegmentSummary, routeWithMetaForSegment } from './routeSegments'
import { resolveDraft, simulateRoute } from './physics'
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
    const elapsedSec = ride.prepare(recordingSimulate, rider).simulateSec!({
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
    expect(elapsedSec).toBe(timed!.result.elapsedSec)
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
        return ride.prepare(simulateRoute, rider).simulateSec!({
          frame,
          wheelset,
          draft: resolveDraft(setting, ride.planGeometry(), rider)
        })
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
    expect(ride.prepare(simulateRoute, { weightKg: 75, heightCm: 175, powerW: 225 }).simulateSec).toBeTypeOf('function')
    expect(ride.planGeometry()).toBe(geometry)
  })
})
