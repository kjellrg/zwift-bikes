import { describe, expect, it } from 'vitest'
import { getRouteBySlug } from './catalog'
import { rideForRoute } from './recommendRide'

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
