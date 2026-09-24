import { describe, expect, it } from 'vitest'
import type { RouteSummary } from '../types/catalog'
import { SILHOUETTE_LISTING_SAMPLES } from './silhouette'
import { toRouteCard } from './routeCards'

const summary = (elevationProfile: { distanceM: number, elevationM: number }[], mix = { gravel: 0, cobble: 0 }) => ({
  slug: 'fixture',
  name: 'Fixture Loop',
  world: 'watopia',
  worldName: 'Watopia',
  distance: 10,
  elevation: 100,
  eventOnly: true,
  terrain: { climbRatio: 10, category: 'rolling', weights: { aero: 0.5, climb: 0.5 }, climbs: [], sprints: [], elevationProfile },
  surface: { road: 100 - mix.gravel - mix.cobble, ...mix, confidence: 'measured', composition: { tarmac: 100 } }
}) as unknown as RouteSummary

describe('toRouteCard', () => {
  it('keeps the numbers a card shows and an outline resampled to a card\'s needs', () => {
    const card = toRouteCard(summary([{ distanceM: 0, elevationM: 0 }, { distanceM: 5000, elevationM: 100 }, { distanceM: 10000, elevationM: 0 }]))
    expect(card).toMatchObject({ slug: 'fixture', name: 'Fixture Loop', world: 'watopia', worldName: 'Watopia', distance: 10, elevation: 100, climbRatio: 10, terrain: 'rolling', eventOnly: true, gravel: false, cobble: false })
    expect(card.shape?.heights).toHaveLength(SILHOUETTE_LISTING_SAMPLES)
    // Nothing of the listing's measured profile rides along beside the outline.
    expect(Object.keys(card)).not.toContain('surface')
  })

  it('says whether any of the route is gravel or cobbles, for the surface filter', () => {
    const profile = [{ distanceM: 0, elevationM: 0 }, { distanceM: 10000, elevationM: 0 }]
    expect(toRouteCard(summary(profile, { gravel: 12, cobble: 0 }))).toMatchObject({ gravel: true, cobble: false })
    expect(toRouteCard(summary(profile, { gravel: 0, cobble: 3 }))).toMatchObject({ gravel: false, cobble: true })
  })

  it('has no outline for a route with no measured profile', () => {
    expect(toRouteCard(summary([])).shape).toBeUndefined()
  })
})
