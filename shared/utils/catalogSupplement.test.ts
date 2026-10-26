import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Route } from 'zwift-data'
import { routes, segments } from 'zwift-data'

// What the catalog gives for supplement files other than the committed ones:
// each test mocks the two JSON files, then loads the modules fresh.
async function catalogWith(supplement: { routes?: unknown[], segments?: unknown[] }) {
  vi.resetModules()
  vi.doMock('../data/supplement/routes.generated.json', () => ({ default: { source: null, zwiftDataVersion: 'test', routes: supplement.routes ?? [] } }))
  vi.doMock('../data/supplement/segments.generated.json', () => ({ default: { source: null, zwiftDataVersion: 'test', segments: supplement.segments ?? [] } }))
  return {
    sources: await import('../data/catalogSources'),
    catalog: await import('./catalog'),
    hosts: await import('../data/segmentHostSupplement')
  }
}

afterEach(() => {
  vi.doUnmock('../data/supplement/routes.generated.json')
  vi.doUnmock('../data/supplement/segments.generated.json')
  vi.resetModules()
})

// Fields the catalog itself corrects on every route, supplement or not:
// the event lead-in (`routeEventLeadIns.ts`) and the hand-written hosts and
// generated placements. Everything else must be the package's own value.
const CORRECTED_BY_THE_CATALOG = new Set(['leadInDistance', 'leadInElevation', 'segments', 'segmentsOnRoute'])

describe('the catalog with empty supplement files', () => {
  it('is the package\'s routes and segments, the very same arrays', async () => {
    const { sources } = await catalogWith({})
    expect(sources.getRoutes()).toBe(routes)
    expect(sources.getSegments()).toBe(segments)
  })

  it('gives getRoutesWithMeta() the package\'s cycling routes, in its order, with nothing but the catalog\'s own corrections', async () => {
    const { catalog } = await catalogWith({})
    const packageCycling = routes.filter(r => r.slug && r.sports.includes('cycling'))
    const merged = catalog.getRoutesWithMeta()
    expect(merged.map(r => r.id)).toEqual(packageCycling.map(r => r.id))
    for (const [i, raw] of packageCycling.entries()) {
      const route = merged[i]!
      for (const [field, value] of Object.entries(raw)) {
        if (!CORRECTED_BY_THE_CATALOG.has(field)) expect(route[field as keyof Route], `${raw.slug}.${field}`).toEqual(value)
      }
      expect(route.segments.slice(0, raw.segments.length), raw.slug).toEqual(raw.segments)
    }
  })
})

describe('the catalog with a correction that adds a Host route', () => {
  it('lists the package\'s hosts, then the hand-written supplement\'s, then the generated ones', async () => {
    const castle = routes.find(r => r.slug === 'castle-to-castle')!
    const { sources, catalog, hosts } = await catalogWith({ routes: [{ id: castle.id, override: { segments: ['alley-sprint-rev'] } }] })
    const handWritten = hosts.supplementHostsFor(castle)
    expect(handWritten).toEqual(['castle-park-sprint'])
    expect(sources.generatedHostsFor(sources.getRoutes().find(r => r.id === castle.id)!)).toEqual(['alley-sprint-rev'])
    expect(catalog.getRouteBySlug('castle-to-castle')!.segments).toEqual([...castle.segments, ...handWritten, 'alley-sprint-rev'])
  })

  it('names no generated host on a route the supplement adds: all of its hosts are its own', async () => {
    const { sources } = await catalogWith({})
    expect(sources.generatedHostsFor({ id: 1, segments: ['hill'] })).toEqual([])
  })
})
