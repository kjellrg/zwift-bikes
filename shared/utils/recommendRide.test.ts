import { describe, expect, it } from 'vitest'
import { getFrames, getRouteBySlug } from './catalog'
import { rideForRoute, rideForSegment } from './recommendRide'
import { getSegmentSummary, routeWithMetaForSegment } from './routeSegments'
import { simulateRoute, tttPowerPlan, tttPowerScaleAtSpeed } from './physics'
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
  it('times the exposed geometry and plan from the warm-up exit speed', () => {
    const route = routeWithMetaForSegment(getSegmentSummary('alpe-du-zwift')!)
    const ride = rideForSegment(route, 3000)
    const rider = { weightKg: 75, heightCm: 175, powerW: 225 }
    const geometry = ride.planGeometry()
    const plan = tttPowerPlan(geometry, 3.5, rider.weightKg, rider.powerW)!
    const calls: { options: Parameters<typeof simulateRoute>[0], result: ReturnType<typeof simulateRoute> }[] = []
    const recordingSimulate: typeof simulateRoute = (options) => {
      const result = simulateRoute(options)
      calls.push({ options, result })
      return result
    }
    const powerScaleAtSpeed = (speed: number) => tttPowerScaleAtSpeed(6, speed)
    const elapsedSec = ride.prepare(recordingSimulate, rider).simulateSec!({
      frame: getFrames().find(frame => frame.name === 'Zwift Carbon')!,
      wheelset: getWheelsets().find(wheelset => wheelset.name === 'Zwift 32mm Carbon')!,
      powerSegmentsW: plan.powerSegmentsW,
      powerScaleAtSpeed
    })
    expect(calls).toHaveLength(2)
    const [warmup, timed] = calls
    expect(warmup!.options.geometry.totalDistanceM).toBe(3000)
    expect(warmup!.options.powerSegmentsW).toBeUndefined()
    expect(warmup!.options.powerScaleAtSpeed).toBe(powerScaleAtSpeed)
    expect(warmup!.result.finalSpeedMps).toBeGreaterThan(0)
    expect(timed!.options.initialSpeedMps).toBe(warmup!.result.finalSpeedMps)
    expect(timed!.options.geometry).toBe(geometry)
    expect(timed!.options.powerSegmentsW).toBe(plan.powerSegmentsW)
    expect(timed!.options.powerScaleAtSpeed).toBe(powerScaleAtSpeed)
    expect(elapsedSec).toBe(timed!.result.elapsedSec)
  })

  it.each(['alley-sprint', 'alpe-du-zwift', 'the-clyde-kicker', '23rd-st'])('keeps %s timing invariant to warm-up distance within 0.1 seconds', (slug) => {
    const route = routeWithMetaForSegment(getSegmentSummary(slug)!)
    const rider = { weightKg: 75, heightCm: 175, powerW: slug === 'alley-sprint' ? 1000 : 225 }
    const frame = getFrames().find(frame => frame.name === 'Zwift Carbon')!
    const wheelset = getWheelsets().find(wheelset => wheelset.name === 'Zwift 32mm Carbon')!
    expect(frame).toBeDefined()
    expect(wheelset).toBeDefined()
    for (const drafted of [false, true]) {
      const times = [2000, 3000, 4000].map((warmup) => {
        const ride = rideForSegment(route, warmup)
        return ride.prepare(simulateRoute, rider).simulateSec!({
          frame,
          wheelset,
          powerSegmentsW: drafted ? tttPowerPlan(ride.planGeometry(), 3.5, rider.weightKg, rider.powerW)?.powerSegmentsW : undefined,
          powerScaleAtSpeed: drafted ? speed => tttPowerScaleAtSpeed(6, speed) : undefined
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
