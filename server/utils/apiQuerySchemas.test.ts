import { describe, expect, it } from 'vitest'
import { DEFAULT_UNOWNED_LEVEL } from '../../shared/utils/classifyBikeFrame'
import { RIDER_BOUNDS } from '../../shared/utils/riderBounds'
import { bikesQuerySchema, recommendRouteQuerySchema, routesQuerySchema } from './apiQuerySchemas'

/**
 * The strict 400 contract from issue #45: wrong values of known parameters
 * reject; junk keys and empty strings do not. Tested at the schema level
 * (plain query objects, as `getQuery` would produce them) - `parseQuery` is a
 * thin h3 wrapper over exactly this.
 */

describe('recommend query defaults', () => {
  it('an empty query fills every documented default', () => {
    const parsed = recommendRouteQuerySchema.parse({})
    expect(parsed.limit).toBe(9)
    expect(parsed.offset).toBe(0)
    expect(parsed.verifiedOnly).toBe(true)
    expect(parsed.includeHalo).toBe(true)
    expect(parsed.ownedOnly).toBe(false)
    expect(parsed.excludeTT).toBe(false)
    expect(parsed.physics).toBe('dynamic')
    expect(parsed.draftMode).toBe('solo')
    expect(parsed.defaultUnownedLevel).toBe(DEFAULT_UNOWNED_LEVEL)
    expect(parsed.owned).toEqual({})
    expect(parsed.ownedWheels).toEqual(new Set())
  })

  it('treats empty strings as unset (browsers serialize unset controls as ?param=)', () => {
    const parsed = recommendRouteQuerySchema.parse({ search: '', category: '', limit: '', weightKg: '' })
    expect(parsed.search).toBeUndefined()
    expect(parsed.category).toBeUndefined()
    expect(parsed.limit).toBe(9)
  })

  it('normalizes search to trimmed lowercase', () => {
    expect(bikesQuerySchema.parse({ search: '  TarMAC ' }).search).toBe('tarmac')
  })
})

describe('wrong values reject rather than silently clamp', () => {
  it.each([
    ['unknown category', { category: 'roadster' }],
    ['limit above range', { limit: '50' }],
    ['offset above range', { offset: '5000' }],
    ['laps above range', { laps: '999' }],
    ['non-numeric number', { limit: 'nine' }],
    ['Infinity', { limit: 'Infinity' }],
    ['repeated parameter', { limit: ['1', '2'] }],
    ['non-boolean flag', { verifiedOnly: 'yes' }],
    ['weight below bound', { weightKg: String(RIDER_BOUNDS.weightKg.min - 1), heightCm: '183', wkg: '3' }]
  ])('%s is a 400', (_label, query) => {
    expect(recommendRouteQuerySchema.safeParse(query).success).toBe(false)
  })

  it('unknown junk keys are ignored (shared links carry utm_* and fbclid)', () => {
    expect(recommendRouteQuerySchema.safeParse({ utm_source: 'x', fbclid: 'y' }).success).toBe(true)
    expect(routesQuerySchema.safeParse({ utm_source: 'x', world: 'watopia' }).success).toBe(true)
  })
})

describe('rider profile is all-or-nothing', () => {
  it('accepts a full profile and rejects a partial one', () => {
    const full = recommendRouteQuerySchema.safeParse({ weightKg: '75', heightCm: '183', wkg: '3.2' })
    expect(full.success).toBe(true)
    for (const partial of [{ weightKg: '75' }, { weightKg: '75', heightCm: '183' }, { wkg: '3.2' }]) {
      expect(recommendRouteQuerySchema.safeParse(partial).success, JSON.stringify(partial)).toBe(false)
    }
  })
})

describe('garage parameters', () => {
  it('rejects malformed owned JSON but clamps and rounds levels inside a valid shape', () => {
    expect(recommendRouteQuerySchema.safeParse({ owned: 'not json' }).success).toBe(false)
    expect(recommendRouteQuerySchema.safeParse({ owned: '[1,2]' }).success).toBe(false)
    expect(recommendRouteQuerySchema.safeParse({ owned: '{"6":"three"}' }).success).toBe(false)
    // Stale localStorage values must not permanently break a page: clamp 0-5,
    // round to whole stages.
    const parsed = recommendRouteQuerySchema.parse({ owned: '{"6":9.7,"7":-2,"8":3.4}' })
    expect(parsed.owned).toEqual({ 6: 5, 7: 0, 8: 3 })
  })

  it('parses ownedWheels as a set of keys and rejects non-arrays', () => {
    expect(recommendRouteQuerySchema.parse({ ownedWheels: '["Zipp 808","ENVE SES 7.8"]' }).ownedWheels).toEqual(new Set(['Zipp 808', 'ENVE SES 7.8']))
    expect(recommendRouteQuerySchema.safeParse({ ownedWheels: '{"a":1}' }).success).toBe(false)
    expect(recommendRouteQuerySchema.safeParse({ ownedWheels: '[1]' }).success).toBe(false)
  })
})
