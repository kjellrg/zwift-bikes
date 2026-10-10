import { describe, expect, it } from 'vitest'
import { segments } from 'zwift-data'
import * as streams from 'zwift-data/streams'
import { NO_STRAVA_SEGMENT, SUPPLEMENT_SEGMENT_STRAVA_IDS, noStravaSegmentReason, supplementIdsThePackageShips, supplementStravaIdFor } from './segmentStravaIdSupplement'

describe('the segment Strava id supplement', () => {
  const entry = supplementStravaIdFor('pave-sprint')!

  it('flags an entry once the package gives the slug a Strava id, whether or not it is the same id', () => {
    expect(supplementIdsThePackageShips([{ slug: 'pave-sprint', stravaSegmentId: entry.stravaSegmentId }], [])).toEqual([entry])
    expect(supplementIdsThePackageShips([{ slug: 'pave-sprint', stravaSegmentId: 1 }], [])).toEqual([entry])
  })

  it('flags an entry once zwift-data/streams ships a track for the slug', () => {
    expect(supplementIdsThePackageShips([{ slug: 'pave-sprint' }], ['pave-sprint'])).toEqual([entry])
  })

  it('does not flag an entry the package still has no id or track for', () => {
    // Tidepool Sprint Rev is not an entry: its id and track upstream flag nothing.
    expect(supplementIdsThePackageShips([{ slug: 'pave-sprint' }, { slug: 'tidepool-sprint-rev', stravaSegmentId: 38169055 }], ['tidepool-sprint-rev'])).toEqual([])
  })

  it('carries no slug the installed zwift-data already has an id or a track for - delete any entry named here', () => {
    expect(supplementIdsThePackageShips(segments, Object.keys(streams.segments))).toEqual([])
  })

  it('names real sprint and climb slugs', () => {
    for (const { segment } of [...SUPPLEMENT_SEGMENT_STRAVA_IDS, ...NO_STRAVA_SEGMENT]) {
      expect(segments.find(s => s.slug === segment)?.type, segment).toMatch(/^(sprint|climb)$/)
    }
  })

  it('lists no slug or id twice, and no slug both with an id and without a Strava segment', () => {
    const slugs = [...SUPPLEMENT_SEGMENT_STRAVA_IDS, ...NO_STRAVA_SEGMENT].map(e => e.segment)
    expect(new Set(slugs).size).toBe(slugs.length)
    const ids = SUPPLEMENT_SEGMENT_STRAVA_IDS.map(e => e.stravaSegmentId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('accounts for every segment #274 lists: an id here, an id upstream, or no Strava segment at all', () => {
    const listed = [
      'village-sprint', 'village-sprint-rev', 'country-sprint', 'country-sprint-rev', 'tidepool-sprint',
      'shisa-sprint', 'shisa-sprint-rev', 'boardwalk-sprint', 'castle-park-sprint', 'castle-park-sprint-rev',
      'ballon-sprint', 'pave-sprint', 'pave-sprint-rev', 'champions-sprint', 'the-clyde-kicker'
    ]
    const accounted = (slug: string) => !!supplementStravaIdFor(slug) || !!noStravaSegmentReason(slug) || !!segments.find(s => s.slug === slug)?.stravaSegmentId
    expect(listed.filter(slug => !accounted(slug))).toEqual([])
    // Downtown Dolphin's Prime: one direction or the other, whichever the fetched length says.
    expect(accounted('prime') || accounted('prime-rev')).toBe(true)
  })

  it('says why Country Sprint forward has no Strava segment, and gives no other slug that reason', () => {
    expect(noStravaSegmentReason('country-sprint')).toMatch(/too short/)
    expect(noStravaSegmentReason('country-sprint-rev')).toBeUndefined()
    expect(supplementStravaIdFor('country-sprint')).toBeUndefined()
  })
})
