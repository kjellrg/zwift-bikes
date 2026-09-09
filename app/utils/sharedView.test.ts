import { describe, expect, it } from 'vitest'
import { SHARED_VIEW_SEARCH_MAX_LENGTH, sharedViewFromQuery, sharedViewQueryPatch } from './sharedView'

/** A query reader over a plain object - what `useUrlState.param` is over a route. */
const query = (params: Record<string, string>) => (key: string) => params[key]

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
    expect(sharedViewFromQuery(query({ laps: '3' }), 5)).toEqual({ laps: 3 })
    expect(sharedViewFromQuery(query({ laps: '9' }), 5)).toEqual({ laps: 5 })
    expect(sharedViewFromQuery(query({ laps: '0' }), 5)).toEqual({ laps: 1 })
    expect(sharedViewFromQuery(query({ laps: 'two' }), 5)).toEqual({})
    // A segment is ridden exactly once: its page has no lap picker to apply to.
    expect(sharedViewFromQuery(query({ laps: '3' }))).toEqual({})
  })
})

describe('sharedViewQueryPatch', () => {
  it('writes nothing for a default view, so its link stays clean', () => {
    expect(sharedViewQueryPatch({ laps: 1, bike: '', category: 'standard', draft: 'solo' }))
      .toEqual({ laps: undefined, bike: undefined, category: undefined, draft: undefined })
  })

  it('writes every non-default value - the hard default, not the stored preference', () => {
    expect(sharedViewQueryPatch({ laps: 3, bike: 'tarmac', category: 'tt', draft: 'ttt' }))
      .toEqual({ laps: 3, bike: 'tarmac', category: 'tt', draft: 'ttt' })
  })

  it('leaves laps alone on a page that does not carry them', () => {
    expect(sharedViewQueryPatch({ bike: '', category: 'all', draft: 'solo' }))
      .toEqual({ bike: undefined, category: 'all', draft: undefined })
  })
})
