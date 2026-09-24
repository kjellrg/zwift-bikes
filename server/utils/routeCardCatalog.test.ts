import { gzipSync } from 'node:zlib'
import { stringify } from 'devalue'
import { describe, expect, it } from 'vitest'
import { getRouteBySlug, getRoutesWithMeta, toRouteSummary } from '../../shared/utils/catalog'
import { relatedRoutes } from '../../shared/utils/relatedRoutes'
import { toRouteCard } from '../../shared/utils/routeCards'
import { allRouteCards, relatedRouteCards, routeCardSilhouette } from './routeCardCatalog'

describe('allRouteCards', () => {
  it('lists every cycling route once, by name, as its card', () => {
    const cards = allRouteCards()
    const cycling = getRoutesWithMeta().filter(route => route.sports.includes('cycling'))
    expect(cards.map(card => card.slug).sort()).toEqual(cycling.map(route => route.slug).sort())
    const names = cards.map(card => card.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    const tempus = getRouteBySlug('tempus-fugit')!
    expect(cards.find(card => card.slug === 'tempus-fugit')).toEqual(toRouteCard(toRouteSummary(tempus)))
  })

  it('is built once per instance and reused', () => {
    expect(allRouteCards()).toBe(allRouteCards())
  })

  // The homepage prerenders every card into its payload and filters them in
  // the browser (#262). Nuxt serialises a payload with devalue, which gives
  // every number its own slot; past this budget the fallback is server-side
  // filtering and paging, see the issue.
  it('fits the homepage payload budget: under 100 KB gzip, serialised the way a payload is', () => {
    const bytes = gzipSync(stringify({ cards: allRouteCards() })).length
    expect(bytes).toBeLessThan(100 * 1024)
  })
})

describe('relatedRouteCards', () => {
  it('picks a route\'s four related cards, each saying whether it is from another world', () => {
    const route = getRouteBySlug('tempus-fugit')!
    const picked = relatedRouteCards('tempus-fugit')!
    const expected = relatedRoutes({ ...route, climbRatio: route.terrain.climbRatio }, allRouteCards())
    expect(picked).toHaveLength(4)
    expect(picked.map(card => [card.slug, card.otherWorld])).toEqual(expected.map(entry => [entry.route.slug, entry.otherWorld]))
    expect(picked[0]).toMatchObject(allRouteCards().find(card => card.slug === picked[0]!.slug)!)
  })

  it('has nothing for a route the catalog does not have', () => {
    expect(relatedRouteCards('no-such-route')).toBeUndefined()
  })
})

describe('routeCardSilhouette', () => {
  it('is the route\'s card Silhouette, so a race row draws what the homepage card does', () => {
    expect(routeCardSilhouette('road-to-sky')).toEqual(allRouteCards().find(card => card.slug === 'road-to-sky')!.shape)
    expect(routeCardSilhouette('no-such-route')).toBeUndefined()
  })
})
