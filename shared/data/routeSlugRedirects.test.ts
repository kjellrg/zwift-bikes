import { describe, expect, it } from 'vitest'
import { routes } from 'zwift-data'
import { getRouteBySlug } from '../utils/catalog'
import { ROUTE_SLUG_REDIRECTS, routeSlugRedirectRules } from './routeSlugRedirects'

describe('the retired route slugs', () => {
  it('each point at a slug the catalog resolves today', () => {
    for (const [from, to] of Object.entries(ROUTE_SLUG_REDIRECTS)) {
      expect(getRouteBySlug(to), `${from} -> ${to}`).toBeDefined()
    }
  })

  it('are no longer slugs of their own, so the redirect never shadows a live page', () => {
    const live = new Set(routes.map(route => route.slug))
    for (const from of Object.keys(ROUTE_SLUG_REDIRECTS)) {
      expect(live.has(from), from).toBe(false)
    }
  })

  it('still name the same route: the old slug was the route id the new slug now carries', () => {
    for (const [from, to] of Object.entries(ROUTE_SLUG_REDIRECTS)) {
      expect(String(getRouteBySlug(to)?.id), from).toBe(from)
    }
  })

  it('become one permanent redirect per old route URL', () => {
    expect(routeSlugRedirectRules()['/routes/4092230492']).toEqual({ redirect: { to: '/routes/urumaze', statusCode: 301 } })
    expect(Object.keys(routeSlugRedirectRules())).toHaveLength(Object.keys(ROUTE_SLUG_REDIRECTS).length)
  })
})
