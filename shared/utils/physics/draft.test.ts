import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import type { RouteGeometry, RouteGeometryPoint } from '../../types/physics'
import { classifyBikeFrame } from '../classifyBikeFrame'
import { getWheelsets } from '../wheelsets'
import { simulateRoute } from './simulator'
import { clampTttClimbWkg, clampTttRiders, TTT_DEFAULT_RIDERS, TTT_MAX_CLIMB_WKG, TTT_MAX_RIDERS, TTT_MIN_CLIMB_WKG, TTT_MIN_RIDERS, tttPowerPlan, tttPowerScaleAtSpeed } from './draft'

function geometry(points: RouteGeometryPoint[]): RouteGeometry {
  const totalDistanceM = points[points.length - 1]!.distanceM
  return {
    routeSlug: 'test-geometry',
    points,
    surfaceSegments: [{ fromM: 0, toM: totalDistanceM, surface: 'tarmac' }],
    totalDistanceM
  }
}

describe('clampTttRiders', () => {
  it('rounds to whole riders and clamps to the supported range', () => {
    expect(clampTttRiders(4.4)).toBe(4)
    expect(clampTttRiders(4.6)).toBe(5)
    expect(clampTttRiders(TTT_MIN_RIDERS - 5)).toBe(TTT_MIN_RIDERS)
    expect(clampTttRiders(TTT_MAX_RIDERS + 5)).toBe(TTT_MAX_RIDERS)
  })

  it('falls back to the default team size on non-finite input', () => {
    expect(clampTttRiders(Number.NaN)).toBe(TTT_DEFAULT_RIDERS)
    expect(clampTttRiders(Number.POSITIVE_INFINITY)).toBe(TTT_DEFAULT_RIDERS)
  })
})

describe('clampTttClimbWkg', () => {
  it('treats unset/invalid/non-positive as "not set"', () => {
    expect(clampTttClimbWkg(undefined)).toBeUndefined()
    expect(clampTttClimbWkg(Number.NaN)).toBeUndefined()
    expect(clampTttClimbWkg(0)).toBeUndefined()
    expect(clampTttClimbWkg(-1)).toBeUndefined()
  })

  it('clamps to the supported range and snaps to the 0.1 the controls step in', () => {
    expect(clampTttClimbWkg(0.5)).toBe(2)
    expect(clampTttClimbWkg(99)).toBe(9)
    // The slider's binary-float accumulation must not leak into query strings.
    expect(clampTttClimbWkg(4.300000000000001)).toBe(4.3)
    expect(clampTttClimbWkg(3.14)).toBe(3.1)
  })
})

describe('tttPowerPlan climb detection is independent of the climb power', () => {
  // A 3 km climb at 5% after a flat lead-up - long and steep enough to
  // qualify at any rider pace the sliders allow.
  const CLIMB_GEOMETRY = geometry([
    { distanceM: 0, elevationM: 0 },
    { distanceM: 2000, elevationM: 0 },
    { distanceM: 5000, elevationM: 150 },
    { distanceM: 7000, elevationM: 150 }
  ])
  const RIDER = { weightKg: 79, powerW: 260 }

  it('the same blocks exist at every climb pace (the control must not gate its own applicability)', () => {
    // Regression: blocks used to be detected at the CLIMB power, so raising
    // the climb pace past the block's speed cutoff silently deleted the
    // block - a higher climb power produced a slower, then constant, finish
    // time (Greater London 8, 4.0 -> 4.1 W/kg).
    const plans = [2.5, 4.0, 4.1, 9].map(climbWkg => tttPowerPlan(CLIMB_GEOMETRY, climbWkg, RIDER.weightKg, RIDER.powerW))
    for (const plan of plans) {
      expect(plan).toBeDefined()
      expect(plan!.blocks.map(b => [b.fromM, b.toM])).toEqual(plans[0]!.blocks.map(b => [b.fromM, b.toM]))
    }
  })

  it('blocks are re-timed at the climb power actually ridden', () => {
    const easy = tttPowerPlan(CLIMB_GEOMETRY, 3, RIDER.weightKg, RIDER.powerW)!
    const hard = tttPowerPlan(CLIMB_GEOMETRY, 5, RIDER.weightKg, RIDER.powerW)!
    expect(hard.blocks[0]!.climbSpeedMps).toBeGreaterThan(easy.blocks[0]!.climbSpeedMps)
    expect(hard.blocks[0]!.estDurationSec).toBeLessThan(easy.blocks[0]!.estDurationSec)
    expect(hard.climbPowerW).toBe(5 * RIDER.weightKg)
  })

  it('simulated total time is strictly monotonic in climb power across the slider\'s full range', () => {
    // The end-to-end guard, composed exactly like the recommend endpoints
    // (plan -> powerSegmentsW -> simulateRoute with the TTT draft scaling).
    // On the old climb-power-based detection this fails at the point where
    // the block's solo speed crosses the 21.1 km/h cutoff (~4.1 W/kg on this
    // grade): the block vanished and total time jumped UP, then flatlined.
    const frame = classifyBikeFrame(bikeFrames.find(f => f.name === 'Zwift Carbon')!, 0)
    const wheelset = getWheelsets().find(w => w.name === 'Zwift 32mm Carbon')!
    const rider = { weightKg: RIDER.weightKg, heightCm: 183, powerW: RIDER.powerW }
    let previous = Number.POSITIVE_INFINITY
    for (let climbWkg = TTT_MIN_CLIMB_WKG; climbWkg <= TTT_MAX_CLIMB_WKG; climbWkg += 0.5) {
      const plan = tttPowerPlan(CLIMB_GEOMETRY, climbWkg, RIDER.weightKg, RIDER.powerW)
      expect(plan, `${climbWkg} W/kg`).toBeDefined()
      const { elapsedSec } = simulateRoute({
        rider,
        frame,
        wheelset,
        geometry: CLIMB_GEOMETRY,
        powerSegmentsW: plan!.powerSegmentsW,
        powerScaleAtSpeed: speedMps => tttPowerScaleAtSpeed(TTT_DEFAULT_RIDERS, speedMps)
      })
      expect(elapsedSec, `${climbWkg} W/kg`).toBeLessThan(previous)
      previous = elapsedSec
    }
  })
})
