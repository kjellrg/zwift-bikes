import { describe, expect, it } from 'vitest'
import { routes } from 'zwift-data'
import { getRouteClimbs, placementsAreRideRelative } from './routeClimbs'

const routeBySlug = (slug: string) => {
  const route = routes.find(r => r.slug === slug)
  expect(route, `zwift-data no longer has a route "${slug}"`).toBeDefined()
  return route!
}

describe('placementsAreRideRelative', () => {
  it('detects lutscher-style routes, whose placements run past the lap', () => {
    // lutscher: 13.7km lap, 10.8km lead-in, Innsbruck KOM placed at km
    // 16.8-24.2 - only a ride coordinate can reach 24km on a 13.7km lap.
    expect(placementsAreRideRelative(routeBySlug('lutscher'))).toBe(true)
    expect(placementsAreRideRelative(routeBySlug('lutscher-ccw'))).toBe(true)
  })

  it('reads the Alpe host routes as lap-relative despite their big lead-ins', () => {
    // Issue #126: assuming ride-relative here shifted the Alpe's placement
    // ~2.3-2.8km early, into the jungle dirt.
    expect(placementsAreRideRelative(routeBySlug('accelerate-to-elevate'))).toBe(false)
    expect(placementsAreRideRelative(routeBySlug('tour-of-fire-and-ice'))).toBe(false)
    expect(placementsAreRideRelative(routeBySlug('road-to-sky'))).toBe(false)
  })
})

describe('getRouteClimbs placement frames', () => {
  it('keeps the lead-in subtraction on ride-relative routes (lutscher, both KOM occurrences)', () => {
    const climbs = getRouteClimbs(routeBySlug('lutscher'))
    const koms = climbs.filter(c => c.slug === 'innsbruck-kom')
    expect(koms).toHaveLength(2)
    const leadInOccurrence = koms.find(c => !c.perLap)
    const lapOccurrence = koms.find(c => c.perLap)
    // Lead-in occurrence keeps its ride coordinate; the lap one is rebased.
    expect(leadInOccurrence?.fromKm).toBeCloseTo(3.13, 1)
    expect(lapOccurrence?.fromKm).toBeCloseTo(6.01, 1)
  })

  it('uses raw positions and perLap=true on lap-relative routes', () => {
    // tour-of-fire-and-ice (2.765km lead-in): the Alpe placement is already
    // lap-relative at km 12.86 - subtracting the lead-in put it at 10.09,
    // 2.77km into the jungle.
    const climbs = getRouteClimbs(routeBySlug('tour-of-fire-and-ice'))
    const alpe = climbs.find(c => c.slug === 'alpe-du-zwift')
    expect(alpe?.perLap).toBe(true)
    expect(alpe?.fromKm).toBeCloseTo(12.86, 1)

    // glyph-heights (8.62km lead-in): the Itza KOM at raw km 0.60 was
    // misclassified as a lead-in-only climb; it is a lap climb.
    const glyph = getRouteClimbs(routeBySlug('glyph-heights'))
    const itza = glyph.find(c => c.slug.includes('itza'))
    expect(itza?.perLap).toBe(true)
    expect(itza?.fromKm).toBeCloseTo(0.60, 1)
  })
})
