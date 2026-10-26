import { describe, expect, it } from 'vitest'
import { routes, segments } from 'zwift-data'
import { getRoutes, getSegments } from './catalogSources'

describe('catalogSources with no supplement', () => {
  it('gives back the package\'s routes exactly', () => {
    expect(getRoutes()).toEqual(routes)
  })

  it('gives back the package\'s segments exactly', () => {
    expect(getSegments()).toEqual(segments)
  })
})
