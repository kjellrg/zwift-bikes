import { describe, expect, it } from 'vitest'
import { routes, segments } from 'zwift-data'
import { HELD_SEGMENTS, SUPPLEMENT_SEGMENT_HOSTS, heldReason, supplementHostsThePackageShips } from './segmentHostSupplement'

describe('the segment host supplement', () => {
  it('flags an entry once the package ships the same pair', () => {
    const shipped = [{ slug: 'sacre-bleu', segments: ['aqueduc-kom', 'pave-sprint'] }]
    expect(supplementHostsThePackageShips(shipped)).toEqual([
      { segment: 'pave-sprint', route: 'sacre-bleu', source: 'game dictionary onRoutes, 2026-10-09' }
    ])
  })

  it('does not count the other direction as the same pair', () => {
    // Sacre Bleu already has `ballon-sprint-rev`; the entry is the forward one.
    expect(supplementHostsThePackageShips([{ slug: 'sacre-bleu', segments: ['ballon-sprint-rev'] }])).toEqual([])
  })

  it('carries no pair the installed zwift-data already ships - delete any entry named here', () => {
    expect(supplementHostsThePackageShips(routes)).toEqual([])
  })

  it('names real segments and routes', () => {
    for (const entry of [...SUPPLEMENT_SEGMENT_HOSTS, ...HELD_SEGMENTS]) expect(segments.some(s => s.slug === entry.segment), entry.segment).toBe(true)
    for (const entry of SUPPLEMENT_SEGMENT_HOSTS) expect(routes.some(r => r.slug === entry.route), entry.route).toBe(true)
  })

  it('holds Breakaway Brae and Alley Sprint, in either direction, for their swapped Strava ids - and nothing else', () => {
    expect(heldReason('breakaway-brae')).toMatch(/Breakaway Brae Strava ids look swapped/)
    expect(heldReason('breakaway-brae-rev')).toMatch(/Breakaway Brae Strava ids look swapped/)
    expect(heldReason('alley-sprint')).toMatch(/Alley Sprint Strava ids are swapped/)
    expect(heldReason('alley-sprint-rev')).toMatch(/Alley Sprint Strava ids are swapped/)
    expect(heldReason('tidepool-sprint-rev')).toBeUndefined()
  })
})
