import { describe, expect, it } from 'vitest'
import { resolveSupplementTracks, supplementTrackLengthMismatch } from './segmentSupplementStreams'
import type { SupplementStreamsFile } from './segmentSupplementStreams'
import { SUPPLEMENT_SEGMENT_STRAVA_IDS } from '../data/segmentStravaIdSupplement'

/** A straight track of this many metres, sampled every 10 m. */
function straightTrack(lengthM: number) {
  const distance = [...Array.from({ length: Math.ceil(lengthM / 10) }, (_, i) => i * 10), lengthM]
  return { latlng: distance.map(d => [0, d / 111_195] as [number, number]), distance, altitude: distance.map(() => 0) }
}
const fetched = (track: ReturnType<typeof straightTrack>) => ({ ...track, fetchedAt: '2026-10-10' })

describe('supplementTrackLengthMismatch', () => {
  it('trusts a track within 20 % of the record\'s distance', () => {
    expect(supplementTrackLengthMismatch(straightTrack(320), 0.32)).toBeUndefined()
    expect(supplementTrackLengthMismatch(straightTrack(250), 0.288)).toBeUndefined()
  })

  it('names the lengths when a track is more than 20 % off - Prime\'s 197 m against Prime Rev\'s 288 m', () => {
    expect(supplementTrackLengthMismatch(straightTrack(197), 0.288)).toBe('track is 197 m; the record says 288 m (32 % off)')
  })
})

describe('resolveSupplementTracks', () => {
  const pave = SUPPLEMENT_SEGMENT_STRAVA_IDS.find(e => e.segment === 'pave-sprint')!
  const primeRev = SUPPLEMENT_SEGMENT_STRAVA_IDS.find(e => e.segment === 'prime-rev')!

  it('gives a fetched track to its slug, by Strava id', () => {
    const track = fetched(straightTrack(333))
    const { tracks, unfetched } = resolveSupplementTracks({ [pave.stravaSegmentId]: track })
    expect(tracks['pave-sprint']).toBe(track)
    expect(unfetched['pave-sprint']).toBeUndefined()
  })

  it('rejects a track whose length is more than 20 % off the record, naming the id', () => {
    const { tracks, rejected } = resolveSupplementTracks({ [primeRev.stravaSegmentId]: fetched(straightTrack(197)) })
    expect(tracks['prime-rev']).toBeUndefined()
    expect(rejected['prime-rev']).toEqual({
      reason: 'supplement-track-length',
      detail: `Strava segment ${primeRev.stravaSegmentId}'s track is 197 m; the record says 288 m (32 % off), so it is not trusted - see the Prime/Breakaway Brae swapped-id caution in #274`
    })
  })

  it('lists every entry with no fetched track by its id', () => {
    const { tracks, unfetched } = resolveSupplementTracks({})
    expect(tracks).toEqual({})
    expect(Object.keys(unfetched)).toHaveLength(SUPPLEMENT_SEGMENT_STRAVA_IDS.length)
    expect(unfetched['pave-sprint']).toBe(pave.stravaSegmentId)
  })

  it('lets the package win: a slug zwift-data/streams already tracks takes no supplement track', () => {
    const packageTrack = straightTrack(333)
    const file: SupplementStreamsFile = { [pave.stravaSegmentId]: fetched(straightTrack(333)) }
    const { tracks, unfetched, rejected } = resolveSupplementTracks(file, { 'pave-sprint': packageTrack })
    expect(tracks['pave-sprint']).toBeUndefined()
    expect(unfetched['pave-sprint']).toBeUndefined()
    expect(rejected['pave-sprint']).toBeUndefined()
  })
})
