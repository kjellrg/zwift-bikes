import { describe, expect, it } from 'vitest'
import { getRoutesWithMeta, getWorlds } from '../../shared/utils/catalog'
import { getAllSegmentSummaries } from '../../shared/utils/routeSegments'
import { allRouteCards } from './routeCardCatalog'
import { worldListing } from './worldListing'

/**
 * A World page's listing (#58), against the catalog: every count here is
 * derived, never pinned - the catalog's own count lives in
 * `shared/utils/catalog.test.ts` alone.
 */
describe('worldListing', () => {
  const listings = getWorlds().map(world => worldListing(world.slug)!)

  it('has a listing for every world in the game, Bologna and Crit City included', () => {
    expect(listings.every(Boolean)).toBe(true)
    expect(listings.map(listing => listing.world)).toEqual(getWorlds().map(({ slug, name }) => ({ slug, name })))
    expect(worldListing('bologna')!.routes.length).toBeGreaterThan(0)
    expect(worldListing('crit-city')!.routes.length).toBeGreaterThan(0)
  })

  it('lists every catalog route in exactly one world, its own', () => {
    const listed = listings.flatMap(listing => listing.routes.map(route => [route.slug, listing.world.slug]))
    expect(listed).toHaveLength(getRoutesWithMeta().length)
    expect(new Set(listed.map(([slug]) => slug)).size).toBe(listed.length)
    expect(Object.fromEntries(listed)).toEqual(Object.fromEntries(getRoutesWithMeta().map(route => [route.slug, route.world])))
  })

  it('lists every segment in exactly one world, its own', () => {
    const listed = listings.flatMap(listing => listing.segments.map(segment => [segment.slug, listing.world.slug]))
    expect(listed).toHaveLength(getAllSegmentSummaries().length)
    expect(new Set(listed.map(([slug]) => slug)).size).toBe(listed.length)
    expect(Object.fromEntries(listed)).toEqual(Object.fromEntries(getAllSegmentSummaries().map(segment => [segment.slug, segment.world])))
  })

  it('lists the routes by name, as the cards the homepage draws', () => {
    const { routes } = worldListing('watopia')!
    const names = routes.map(route => route.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(routes[0]).toMatchObject(allRouteCards().find(card => card.slug === routes[0]!.slug)!)
  })

  it('lists the climbs first, most climbing first, then the sprints by name, as the segments index does', () => {
    const { segments } = worldListing('watopia')!
    const firstSprint = segments.findIndex(segment => segment.type === 'sprint')
    const climbs = segments.slice(0, firstSprint)
    const sprints = segments.slice(firstSprint)
    expect(climbs.length).toBeGreaterThan(0)
    expect(climbs.every(segment => segment.type === 'climb')).toBe(true)
    expect(sprints.every(segment => segment.type === 'sprint')).toBe(true)
    const gains = climbs.map(segment => segment.measuredElevationM ?? segment.elevationM)
    expect(gains).toEqual([...gains].sort((a, b) => b - a))
    expect(climbs[0]!.slug).toBe('alpe-du-zwift')
    const names = sprints.map(segment => segment.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('has no listing for a world the game does not have', () => {
    expect(worldListing('mars')).toBeUndefined()
    expect(worldListing('')).toBeUndefined()
  })
})

describe('a World page row\'s surface', () => {
  it('carries the shares the route page states, not the card\'s any-amount flags', () => {
    const hilly = worldListing('watopia')!.routes.find(route => route.slug === 'hilly-route')!
    const catalog = getRoutesWithMeta().find(route => route.slug === 'hilly-route')!
    expect(hilly.surface).toEqual({ gravel: catalog.surface.gravel, cobble: catalog.surface.cobble })
    expect(hilly.cobble).toBe(true)
    expect(hilly.surface.cobble).toBeGreaterThan(0)
    expect(hilly.surface.cobble).toBeLessThan(10)
  })
})
