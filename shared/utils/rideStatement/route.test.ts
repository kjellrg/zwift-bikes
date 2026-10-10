import { describe, expect, it } from 'vitest'
import { getRouteBySlug } from '../catalog'
import { rideForRoute } from '../recommendRide'
import { routeStatement } from './route'

const SITE = 'https://zwiftbikes.com'
const hilly = getRouteBySlug('hilly-route')!

describe('routeStatement', () => {
  it('names the route and asks the page\'s question', () => {
    const statement = routeStatement({ ride: rideForRoute(hilly, 1), siteUrl: SITE })
    expect(statement.rideName).toBe('Watopia Hilly Route in Watopia')
    expect(statement.question).toBe('What\'s the fastest bike for Watopia Hilly Route?')
    expect(statement.title).toBe('Fastest bike for Watopia Hilly Route in Watopia | ZwiftBikes')
    expect(statement.ogTitle).toBe('Fastest bike for Watopia Hilly Route')
    expect(statement.heading).toEqual({
      name: 'Watopia Hilly Route',
      crumbs: [{ label: 'All routes', to: '/' }, { label: 'Watopia', to: '/worlds/watopia' }, { label: 'Rolling' }]
    })
    // The world is the trail's middle entry, visible and marked up (#58).
    expect(statement.breadcrumbs).toEqual([
      { name: 'Home', item: SITE },
      { name: 'Watopia', item: `${SITE}/worlds/watopia` },
      { name: 'Watopia Hilly Route', item: `${SITE}/routes/hilly-route` }
    ])
    expect(statement.reportItem).toBe('Watopia Hilly Route')
    expect(statement.reportSubject).toBeUndefined()
    expect(statement.rules).toBeUndefined()
  })

  it('describes one lap, lead-in once, and names rank 1 when there is one', () => {
    expect(routeStatement({ ride: rideForRoute(hilly, 3), siteUrl: SITE }).description)
      .toBe('The best bike and wheels for Watopia Hilly Route in Watopia (9.7 km, 110 m of climbing), ranked by predicted finish time for your weight and power.')
    const answered = routeStatement({ ride: rideForRoute(hilly, 1), siteUrl: SITE, answer: { setup: 'Zwift Carbon with Zwift 32mm Carbon', category: 'standard' } })
    expect(answered.description).toBe('The best bike and wheels for Watopia Hilly Route: ZwiftBikes predicts the Zwift Carbon with Zwift 32mm Carbon, fastest on road bikes.')
    expect(answered.ogDescription).toBe('Every Zwift frame and wheelset ranked by finish time on Watopia Hilly Route in Watopia – 9.7 km with 110 m of climbing.')
  })

  it('gives the share card one lap\'s figures and its alt text', () => {
    expect(routeStatement({ ride: rideForRoute(hilly, 3), siteUrl: SITE }).shareCard).toEqual({
      props: { title: 'Watopia Hilly Route', world: 'Watopia', distance: '9.7 km', elevation: '110 m' },
      alt: 'Fastest bike for Watopia Hilly Route in Watopia: the route\'s profile and its fastest bike and wheel setup'
    })
  })

  it('builds the Fact row for the lap count picked, the lead-in once', () => {
    const one = routeStatement({ ride: rideForRoute(hilly, 1), siteUrl: SITE })
    expect(one.facts).toEqual([
      { value: '9.7 km', label: 'with the 0.5 km lead-in' },
      { value: '110 m', label: 'of climbing' },
      { value: '11.9 m/km', label: 'climb ratio' },
      { value: '1', label: 'named climb, 1 sprint' }
    ])
    expect(one.surface?.key.map(entry => entry.text)).toEqual(['95.3% tarmac', '4.7% cobbles and wood'])
    expect(one.coverageNote).toBeUndefined()

    const three = routeStatement({ ride: rideForRoute(hilly, 3), siteUrl: SITE })
    expect(three.facts.slice(0, 2)).toEqual([
      { value: '28.1 km', label: '3 laps + 0.5 km lead-in' },
      { value: '328 m', label: 'of climbing' }
    ])
  })

  it('notes surfaces the model has not mapped', () => {
    const curated = { ...hilly, surface: { ...hilly.surface, confidence: 'curated' as const, segments: undefined } }
    expect(routeStatement({ ride: rideForRoute(curated, 1), siteUrl: SITE }).coverageNote).toBe('Curated surface estimate; locations unavailable.')
  })

  it('marks an event-only route in its crumbs', () => {
    expect(routeStatement({ ride: rideForRoute({ ...hilly, eventOnly: true }, 1), siteUrl: SITE }).heading.crumbs.at(-1)).toEqual({ label: 'Event only' })
  })
})
