import { describe, expect, it } from 'vitest'
import type { RouteCardData } from '#shared/utils/routeCards'
import { filterRouteCards, NO_ROUTE_FILTERS, type RouteCardFilters } from './routeCardFilters'

const card = (slug: string, overrides: Partial<RouteCardData> = {}): RouteCardData => ({
  slug,
  name: slug.replace(/-/g, ' '),
  world: 'watopia',
  worldName: 'Watopia',
  distance: 20,
  elevation: 200,
  climbRatio: 10,
  terrain: 'rolling',
  eventOnly: false,
  gravel: false,
  cobble: false,
  shape: undefined,
  ...overrides
})

const slugs = (cards: RouteCardData[]) => cards.map(entry => entry.slug)
const only = (filters: Partial<RouteCardFilters>) => ({ ...NO_ROUTE_FILTERS, ...filters })

describe('filterRouteCards', () => {
  const cards = [
    card('road-to-sky', { distance: 17, elevation: 1060, terrain: 'mountainous' }),
    card('tempus-fugit', { distance: 19, elevation: 30, terrain: 'flat' }),
    card('the-muckle-yin', { world: 'scotland', worldName: 'Scotland', gravel: true, distance: 23, elevation: 250 }),
    card('cobbled-climbs', { world: 'richmond', worldName: 'Richmond', cobble: true, distance: 88, elevation: 1000, terrain: 'hilly' })
  ]

  it('keeps every card, in order, with no filter set', () => {
    expect(slugs(filterRouteCards(cards, NO_ROUTE_FILTERS))).toEqual(slugs(cards))
  })

  it('searches the name the way the listing endpoint did: trimmed, any case, anywhere in it', () => {
    expect(slugs(filterRouteCards(cards, only({ search: '  FUGIT ' })))).toEqual(['tempus-fugit'])
    expect(slugs(filterRouteCards(cards, only({ search: '   ' })))).toEqual(slugs(cards))
  })

  it('narrows to a world and to a surface the route includes', () => {
    expect(slugs(filterRouteCards(cards, only({ world: 'scotland' })))).toEqual(['the-muckle-yin'])
    expect(slugs(filterRouteCards(cards, only({ surface: 'gravel' })))).toEqual(['the-muckle-yin'])
    expect(slugs(filterRouteCards(cards, only({ surface: 'cobble' })))).toEqual(['cobbled-climbs'])
  })

  it('keeps a distance and an elevation range inclusive, each end open at the slider\'s limit', () => {
    expect(slugs(filterRouteCards(cards, only({ distance: [17, 19] })))).toEqual(['road-to-sky', 'tempus-fugit'])
    expect(slugs(filterRouteCards(cards, only({ elevation: [250, 1000] })))).toEqual(['the-muckle-yin', 'cobbled-climbs'])
    // The top of each slider means "and over": a 3000 m route is not cut by 0-2000.
    const huge = card('huge', { distance: 200, elevation: 3000 })
    expect(slugs(filterRouteCards([huge], only({ distance: [0, 120], elevation: [0, 2000] })))).toEqual(['huge'])
    expect(slugs(filterRouteCards([huge], only({ distance: [0, 115] })))).toEqual([])
  })

  it('narrows to any of the chosen terrains', () => {
    expect(slugs(filterRouteCards(cards, only({ terrain: ['flat', 'hilly'] })))).toEqual(['tempus-fugit', 'cobbled-climbs'])
  })

  it('applies every filter at once', () => {
    expect(slugs(filterRouteCards(cards, only({ world: 'watopia', terrain: ['mountainous', 'flat'], elevation: [0, 500] })))).toEqual(['tempus-fugit'])
  })
})
