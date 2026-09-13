import { describe, expect, it } from 'vitest'
import { SHARED_VIEW_SEARCH_MAX_LENGTH, sharedViewFromQuery, sharedViewQueryPatch } from './sharedView'

/** A query reader over a plain object - what `useUrlState.param` is over a route. */
const query = (params: Record<string, string>) => (key: string) => params[key]

/** The two numeric selections: a route's lap picker counts from one, a race's category groups from zero. */
const LAPS = { key: 'laps', min: 1, max: 5 } as const
const GROUP = { key: 'group', min: 0, max: 1 } as const
/** The enum one: the Race format a segment page is ridden under, where absent means "not a race". */
const RULES = { key: 'rules', values: ['ttt', 'points', 'scratch', 'rot'] } as const

describe('sharedViewFromQuery', () => {
  it('applies a category the filter offers and drops one it does not', () => {
    expect(sharedViewFromQuery(query({ category: 'tt' }))).toEqual({ category: 'tt' })
    expect(sharedViewFromQuery(query({ category: 'mtb' }))).toEqual({})
  })

  it('applies a draft mode the profile offers and drops one it does not', () => {
    expect(sharedViewFromQuery(query({ draft: 'ttt' }))).toEqual({ draft: 'ttt' })
    expect(sharedViewFromQuery(query({ draft: 'peloton' }))).toEqual({})
  })

  it('applies a bike search, cut to the shared-view cap', () => {
    expect(sharedViewFromQuery(query({ bike: 'tarmac' }))).toEqual({ bike: 'tarmac' })
    const long = sharedViewFromQuery(query({ bike: 'x'.repeat(250) }))
    expect(long.bike).toHaveLength(SHARED_VIEW_SEARCH_MAX_LENGTH)
  })

  it('applies laps only on a page that carries them, clamped into the lap picker', () => {
    expect(sharedViewFromQuery(query({ laps: '3' }), LAPS)).toEqual({ selection: 3 })
    expect(sharedViewFromQuery(query({ laps: '9' }), LAPS)).toEqual({ selection: 5 })
    expect(sharedViewFromQuery(query({ laps: '0' }), LAPS)).toEqual({ selection: 1 })
    expect(sharedViewFromQuery(query({ laps: 'two' }), LAPS)).toEqual({})
    // A segment is ridden exactly once: its page has no lap picker to apply to.
    expect(sharedViewFromQuery(query({ laps: '3' }))).toEqual({})
  })

  it('applies a race format the enum knows and drops one it does not', () => {
    expect(sharedViewFromQuery(query({ rules: 'points' }), RULES)).toEqual({ selection: 'points' })
    expect(sharedViewFromQuery(query({ rules: 'ttt' }), RULES)).toEqual({ selection: 'ttt' })
    // Dropped rather than mapped to a neighbour, like the other enums: a link
    // carries what someone saw, and a format nobody could select is a typo.
    expect(sharedViewFromQuery(query({ rules: 'handicap' }), RULES)).toEqual({})
    expect(sharedViewFromQuery(query({ rules: '' }), RULES)).toEqual({})
    // Absent is "not a race", which is the value a clean link omits.
    expect(sharedViewFromQuery(query({}), RULES)).toEqual({})
    // A page with a numeric selection ignores the key entirely, and vice versa.
    expect(sharedViewFromQuery(query({ rules: 'points' }), LAPS)).toEqual({})
    expect(sharedViewFromQuery(query({ laps: '3' }), RULES)).toEqual({})
  })

  it('applies a category group from zero, and reads neither key on the other page', () => {
    expect(sharedViewFromQuery(query({ group: '1' }), GROUP)).toEqual({ selection: 1 })
    // Clamped to the group the race actually has, and never below the first one.
    expect(sharedViewFromQuery(query({ group: '7' }), GROUP)).toEqual({ selection: 1 })
    expect(sharedViewFromQuery(query({ group: '-2' }), GROUP)).toEqual({ selection: 0 })
    // Each page reads its own key only: a `?laps=` on a race is somebody else's param.
    expect(sharedViewFromQuery(query({ laps: '3' }), GROUP)).toEqual({})
    expect(sharedViewFromQuery(query({ group: '1' }), LAPS)).toEqual({})
  })
})

describe('sharedViewQueryPatch', () => {
  it('writes nothing for a default view, so its link stays clean', () => {
    expect(sharedViewQueryPatch({ selection: { key: 'laps', value: 1, min: 1 }, bike: '', category: 'standard', draft: 'solo' }))
      .toEqual({ laps: undefined, bike: undefined, category: undefined, draft: undefined })
  })

  it('writes every non-default value - the hard default, not the stored preference', () => {
    expect(sharedViewQueryPatch({ selection: { key: 'laps', value: 3, min: 1 }, bike: 'tarmac', category: 'tt', draft: 'ttt' }))
      .toEqual({ laps: 3, bike: 'tarmac', category: 'tt', draft: 'ttt' })
  })

  it('measures a selection against its own floor, so the first category group is the clean one', () => {
    expect(sharedViewQueryPatch({ selection: { key: 'group', value: 0, min: 0 }, bike: '', category: 'standard', draft: 'solo' }))
      .toEqual({ group: undefined, bike: undefined, category: undefined, draft: undefined })
    expect(sharedViewQueryPatch({ selection: { key: 'group', value: 1, min: 0 }, bike: '', category: 'standard', draft: 'solo' }))
      .toEqual({ group: 1, bike: undefined, category: undefined, draft: undefined })
  })

  it('writes a race format, and nothing at all for "not a race"', () => {
    expect(sharedViewQueryPatch({ selection: { key: 'rules', value: 'points' }, bike: '', category: 'standard', draft: 'solo' }))
      .toEqual({ rules: 'points', bike: undefined, category: undefined, draft: undefined })
    expect(sharedViewQueryPatch({ selection: { key: 'rules', value: undefined }, bike: '', category: 'standard', draft: 'solo' }))
      .toEqual({ rules: undefined, bike: undefined, category: undefined, draft: undefined })
  })

  it('round-trips a race format through a link', () => {
    const patch = sharedViewQueryPatch({ selection: { key: 'rules', value: 'rot' }, bike: 'tarmac', category: 'tt', draft: 'solo' })
    expect(sharedViewFromQuery(key => patch[key] as string | undefined, RULES))
      .toEqual({ selection: 'rot', bike: 'tarmac', category: 'tt' })
  })

  it('leaves both selection keys alone on a page that carries neither', () => {
    expect(sharedViewQueryPatch({ bike: '', category: 'all', draft: 'solo' }))
      .toEqual({ bike: undefined, category: 'all', draft: undefined })
  })
})
