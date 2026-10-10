import { describe, expect, it } from 'vitest'
import { getRouteBySlug } from '../utils/catalog'
import generated from './routeSurfaces.generated.json'

describe('the measured route surfaces', () => {
  it('are keyed only by routes the catalog resolves, so no entry is dead weight (#326)', () => {
    const orphaned = Object.keys(generated).filter(slug => !getRouteBySlug(slug))
    expect(orphaned).toEqual([])
  })
})
