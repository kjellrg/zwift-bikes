import { describe, expect, it } from 'vitest'
import { routes } from 'zwift-data'
import { getRouteBySlug, getRoutesWithMeta } from './catalog'
import { placementsAreRideRelative } from './routeClimbs'

describe('getRoutesWithMeta: cycling routes only (#324)', () => {
  it('holds the 293 cycling routes and none of the running-only ones', () => {
    const catalog = getRoutesWithMeta()
    expect(catalog).toHaveLength(293)
    expect(catalog).toHaveLength(routes.filter(r => r.slug && r.sports.includes('cycling')).length)
    for (const route of catalog) expect(route.sports, route.slug).toContain('cycling')
  })

  it('finds a cycling route by slug and not a running-only one', () => {
    expect(getRouteBySlug('lutece-express-run')).toBeUndefined()
    expect(getRouteBySlug('hilly-route')).toBeDefined()
  })
})

describe('getRoutesWithMeta: segment hosts and placements beyond zwift-data (#273)', () => {
  it('adds the supplement\'s hosts to the route\'s membership, after the package\'s own', () => {
    expect(getRouteBySlug('castle-to-castle')!.segments).toEqual(['alley-sprint', 'tower-sprint', 'castle-park-sprint'])
    expect(getRouteBySlug('outer-scotland')!.segments).toEqual(['champions-sprint', 'the-clyde-kicker', 'breakaway-brae'])
  })

  it('places a generated placement on the route, where the route\'s terrain reads it', () => {
    const kaze = getRouteBySlug('kaze-kicker')!
    const tidepool = kaze.terrain.sprints.find(s => s.slug === 'tidepool-sprint-rev')
    expect(tidepool).toBeDefined()
    expect(tidepool!.fromKm).toBeCloseTo(1.34, 1)
    expect(tidepool!.perLap).toBe(true)
  })

  it('removes no host and moves no zwift-data placement', () => {
    for (const raw of routes.filter(r => r.slug && r.sports.includes('cycling'))) {
      const merged = getRouteBySlug(raw.slug)!
      for (const slug of raw.segments ?? []) expect(merged.segments, raw.slug).toContain(slug)
      for (const placed of raw.segmentsOnRoute ?? []) expect(merged.segmentsOnRoute, raw.slug).toContainEqual(placed)
    }
  })

  it('changes no route\'s placement frame: generated placements never make a lap-relative route read as ride-relative', () => {
    const flipped = getRoutesWithMeta()
      .filter(merged => placementsAreRideRelative(merged) !== placementsAreRideRelative(routes.find(r => r.slug === merged.slug)!))
      .map(r => r.slug)
    expect(flipped).toEqual([])
  })
})
