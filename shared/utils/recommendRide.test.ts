import { describe, expect, it } from 'vitest'
import { getRouteBySlug } from './catalog'
import { rideForRoute, rideForSegment } from './recommendRide'
import { getSegmentSummary, routeWithMetaForSegment } from './routeSegments'
import { simulateRoute } from './physics'

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
