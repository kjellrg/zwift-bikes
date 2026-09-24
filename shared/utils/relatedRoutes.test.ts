import { describe, expect, it } from 'vitest'
import { relatedRoutes } from './relatedRoutes'

const route = (slug: string, world: string, climbRatio: number, distance = 20, eventOnly = false) => ({ slug, world, distance, eventOnly, climbRatio })

describe('relatedRoutes', () => {
  const target = route('target', 'watopia', 10, 40)

  it('picks the same world\'s nearest climb ratios, then distances, leaving out itself and event-only routes', () => {
    const picked = relatedRoutes(target, [
      target,
      route('far', 'watopia', 30),
      route('near-long', 'watopia', 11, 90),
      route('near-short', 'watopia', 11, 38),
      route('event', 'watopia', 10, 40, true),
      route('close', 'watopia', 10.5),
      route('next', 'watopia', 12)
    ])
    expect(picked.map(entry => entry.route.slug)).toEqual(['close', 'near-short', 'near-long', 'next'])
    expect(picked.every(entry => !entry.otherWorld)).toBe(true)
  })

  it('fills a small world\'s gaps from any world by the same measure, marked as elsewhere', () => {
    const picked = relatedRoutes(target, [route('home', 'watopia', 20), route('away-near', 'london', 10), route('away-far', 'paris', 40), route('away-mid', 'paris', 14)], 3)
    expect(picked.map(entry => [entry.route.slug, entry.otherWorld])).toEqual([['home', false], ['away-near', true], ['away-mid', true]])
  })
})
