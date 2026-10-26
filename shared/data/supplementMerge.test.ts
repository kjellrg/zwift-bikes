import { describe, expect, it } from 'vitest'
import type { Route, Segment } from 'zwift-data'
import {
  ROUTE_OVERRIDE_FIELDS,
  applyRouteSupplement,
  applySegmentSupplement,
  handWrittenDuplicateFindings,
  isStaleFinding,
  pruneRouteEntries,
  pruneSegmentEntries,
  routeSupplementFindings,
  segmentSupplementFindings
} from './supplementMerge'

const route = (id: number, slug: string, extra: Partial<Route> = {}): Route => ({
  id,
  name: slug.replace(/-/g, ' '),
  slug,
  world: 'watopia',
  distance: 10,
  elevation: 100,
  segments: [],
  segmentsOnRoute: [],
  sports: ['cycling'],
  eventOnly: false,
  levelLocked: false,
  lap: false,
  supportsTT: false,
  supportsMeetups: false,
  ...extra
})

const segment = (slug: string, extra: Partial<Segment> = {}): Segment => ({
  name: slug.replace(/-/g, ' '),
  slug,
  world: 'watopia',
  type: 'segment',
  distance: 1,
  ...extra
})

const base = [route(1, 'alpha'), route(2, 'bravo', { segments: ['hill'], segmentsOnRoute: [{ from: 1, to: 2, segment: 'hill' }], stravaSegmentId: 10 })]

describe('applyRouteSupplement', () => {
  it('gives back the package\'s own array when there are no entries', () => {
    expect(applyRouteSupplement(base, [])).toBe(base)
  })

  it('appends a route the package lacks, after the package\'s own', () => {
    const merged = applyRouteSupplement(base, [route(3, 'charlie')])
    expect(merged.map(r => r.slug)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(merged[0]).toBe(base[0])
  })

  it('uses the package\'s record when it ships the same id', () => {
    const merged = applyRouteSupplement(base, [route(1, 'alpha-renamed', { distance: 99 })])
    expect(merged).toEqual(base)
  })

  it('skips a route whose slug is another package route\'s', () => {
    expect(applyRouteSupplement(base, [route(9, 'alpha')])).toEqual(base)
  })

  it('skips a route whose name is another package route\'s in the same world, but not in another world', () => {
    const sameName = route(9, 'other-slug', { name: 'Alpha' })
    expect(applyRouteSupplement(base, [sameName])).toEqual(base)
    expect(applyRouteSupplement(base, [{ ...sameName, world: 'london' }])).toHaveLength(3)
  })

  it('keeps the first of two supplement routes that share an id or a slug', () => {
    const merged = applyRouteSupplement(base, [route(3, 'charlie'), route(3, 'delta'), route(4, 'charlie')])
    expect(merged.map(r => r.slug)).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('overrides a scalar field until the package matches it', () => {
    const merged = applyRouteSupplement(base, [{ id: 2, override: { stravaSegmentId: 11, stravaSegmentUrl: 'https://www.strava.com/segments/11' } }])
    expect(merged[1]).toMatchObject({ stravaSegmentId: 11, stravaSegmentUrl: 'https://www.strava.com/segments/11', slug: 'bravo' })
    expect(applyRouteSupplement(base, [{ id: 2, override: { stravaSegmentId: 10 } }])[1]).toBe(base[1])
  })

  it('applies every field the allow-list names, so a correction to one is never mistaken for matched', () => {
    const changed: Record<(typeof ROUTE_OVERRIDE_FIELDS)[number], unknown> = {
      name: 'Bravo Two',
      segments: ['peak'],
      segmentsOnRoute: [{ from: 3, to: 4, segment: 'peak' }],
      stravaSegmentId: 11,
      stravaSegmentUrl: 'https://www.strava.com/segments/11',
      leadInDistance: 1.5,
      leadInElevation: 7
    }
    for (const field of ROUTE_OVERRIDE_FIELDS) {
      const merged = applyRouteSupplement(base, [{ id: 2, override: { [field]: changed[field] } }])
      expect(merged[1], field).not.toBe(base[1])
      expect(routeSupplementFindings(base, [{ id: 2, override: { [field]: changed[field] } }], new Set(['hill', 'peak'])), field).toEqual([])
    }
  })

  it('only adds to segments and segmentsOnRoute', () => {
    const merged = applyRouteSupplement(base, [{
      id: 2,
      override: { segments: ['peak'], segmentsOnRoute: [{ from: 0, to: 0.5, segment: 'peak' }] }
    }])
    expect(merged[1]?.segments).toEqual(['hill', 'peak'])
    expect(merged[1]?.segmentsOnRoute).toEqual([{ from: 0, to: 0.5, segment: 'peak' }, { from: 1, to: 2, segment: 'hill' }])
  })

  it('never takes a host or a placement the package has away', () => {
    const merged = applyRouteSupplement(base, [{ id: 2, override: { segments: [], segmentsOnRoute: [] } }])
    expect(merged[1]).toBe(base[1])
  })

  it('does not repeat a host or placement the package already has', () => {
    const merged = applyRouteSupplement(base, [{ id: 2, override: { segments: ['hill'], segmentsOnRoute: [{ from: 1, to: 2, segment: 'hill' }] } }])
    expect(merged[1]).toBe(base[1])
  })

  it('ignores an override of a route the package does not have', () => {
    expect(applyRouteSupplement(base, [{ id: 99, override: { name: 'Ghost' } }])).toEqual(base)
  })
})

describe('applySegmentSupplement', () => {
  const segments = [segment('hill'), segment('peak', { stravaSegmentId: 5 })]

  it('gives back the package\'s own array when there are no entries', () => {
    expect(applySegmentSupplement(segments, [])).toBe(segments)
  })

  it('appends a segment the package lacks, and uses the package\'s record when it ships the slug', () => {
    const merged = applySegmentSupplement(segments, [segment('valley'), segment('hill', { distance: 99 })])
    expect(merged.map(s => s.slug)).toEqual(['hill', 'peak', 'valley'])
    expect(merged[0]).toBe(segments[0])
  })

  it('skips a segment whose name is another package segment\'s in the same world', () => {
    expect(applySegmentSupplement(segments, [segment('hill-2', { name: 'Hill' })])).toEqual(segments)
  })

  it('overrides only the allowed fields, until the package matches', () => {
    const merged = applySegmentSupplement(segments, [{ slug: 'hill', override: { stravaSegmentId: 7, stravaSegmentUrl: 'https://www.strava.com/segments/7' } }])
    expect(merged[0]).toMatchObject({ slug: 'hill', stravaSegmentId: 7 })
    expect(applySegmentSupplement(segments, [{ slug: 'peak', override: { stravaSegmentId: 5 } }])[1]).toBe(segments[1])
  })
})

describe('supplement findings and pruning', () => {
  const known = new Set(['hill', 'peak'])

  it('names an addition the package now ships, and prune removes it', () => {
    const entries = [route(1, 'alpha'), route(3, 'charlie')]
    expect(routeSupplementFindings(base, entries, known)).toEqual([
      expect.objectContaining({ identity: 'alpha (1)', reason: 'shipped' })
    ])
    expect(pruneRouteEntries(base, entries).map(e => e.id)).toEqual([3])
  })

  it('names an override the package now matches, and prune removes it', () => {
    const entries = [{ id: 2, override: { stravaSegmentId: 10 } }, { id: 1, override: { name: 'Alpha Two' } }]
    expect(routeSupplementFindings(base, entries, known)).toEqual([
      expect.objectContaining({ identity: 'bravo (2)', reason: 'matched' })
    ])
    expect(pruneRouteEntries(base, entries)).toEqual([entries[1]])
  })

  it('reports what the merge skips, and prune keeps it for a person to fix', () => {
    const entries = [route(9, 'alpha'), route(8, 'other', { name: 'Bravo' }), { id: 77, override: { name: 'Ghost' } }]
    expect(routeSupplementFindings(base, entries, known).map(f => f.reason)).toEqual(['slug-collision', 'name-collision', 'no-record'])
    expect(pruneRouteEntries(base, entries)).toEqual(entries)
  })

  it('reports a route that names a segment no catalog has', () => {
    const entries = [route(3, 'charlie', { segments: ['hill', 'nowhere'] })]
    expect(routeSupplementFindings(base, entries, known)).toEqual([
      expect.objectContaining({ reason: 'unknown-segment', detail: expect.stringContaining('nowhere') })
    ])
  })

  it('reports the same identity listed twice', () => {
    expect(routeSupplementFindings(base, [route(3, 'charlie'), route(3, 'charlie')], known).map(f => f.reason)).toContain('duplicate')
    expect(segmentSupplementFindings([], [segment('valley'), segment('valley')]).map(f => f.reason)).toContain('duplicate')
  })

  it('does the same for segments', () => {
    const segments = [segment('hill'), segment('peak', { stravaSegmentId: 5 })]
    const entries = [segment('hill'), segment('valley'), { slug: 'peak', override: { stravaSegmentId: 5 } }, { slug: 'nowhere', override: { name: 'x' } }]
    expect(segmentSupplementFindings(segments, entries).map(f => `${f.identity}:${f.reason}`)).toEqual(['hill:shipped', 'peak:matched', 'nowhere:no-record'])
    expect(pruneSegmentEntries(segments, entries)).toEqual([entries[1], entries[3]])
  })
})

describe('handWrittenDuplicateFindings', () => {
  const input = { packageRoutes: base, hosts: [], stravaIds: [] }

  it('names a hand-written host a generated route also lists', () => {
    const findings = handWrittenDuplicateFindings({
      ...input,
      routes: [route(3, 'charlie', { segments: ['hill'] }), { id: 1, override: { segments: ['peak'] } }],
      segments: [],
      hosts: [{ segment: 'hill', route: 'charlie' }, { segment: 'peak', route: 'alpha' }, { segment: 'peak', route: 'bravo' }]
    })
    expect(findings.map(f => f.identity)).toEqual(['hill on charlie', 'peak on alpha'])
    expect(findings.every(f => f.reason === 'hand-written')).toBe(true)
  })

  it('names a hand-written Strava id a generated segment also carries', () => {
    const findings = handWrittenDuplicateFindings({
      ...input,
      routes: [],
      segments: [segment('valley', { stravaSegmentId: 3 }), { slug: 'hill', override: { stravaSegmentId: 4 } }, segment('peak')],
      stravaIds: [{ segment: 'valley', stravaSegmentId: 3 }, { segment: 'hill', stravaSegmentId: 4 }, { segment: 'peak', stravaSegmentId: 5 }]
    })
    expect(findings.map(f => f.identity)).toEqual(['valley', 'hill'])
  })

  it('skips a correction of a route the package does not have, which no-record already reports', () => {
    const findings = handWrittenDuplicateFindings({ ...input, routes: [{ id: 99, override: { segments: ['hill'] } }], segments: [], hosts: [{ segment: 'hill', route: 'ghost' }] })
    expect(findings).toEqual([])
  })

  it('finds nothing when the two do not overlap', () => {
    expect(handWrittenDuplicateFindings({ ...input, routes: [route(3, 'charlie')], segments: [], hosts: [{ segment: 'hill', route: 'charlie' }] })).toEqual([])
  })
})

describe('isStaleFinding', () => {
  it('is what supplement:prune deletes: what the package has caught up with, and nothing a person must fix', () => {
    const finding = (reason: Parameters<typeof isStaleFinding>[0]['reason']) => isStaleFinding({ kind: 'route', identity: 'x', reason, detail: '' })
    expect(['shipped', 'matched', 'stream-shipped'].map(r => finding(r as never))).toEqual([true, true, true])
    expect(['no-record', 'slug-collision', 'name-collision', 'duplicate', 'unknown-segment', 'no-id', 'hand-written', 'stream-orphan', 'no-surface'].map(r => finding(r as never))).toEqual(Array(9).fill(false))
  })
})
