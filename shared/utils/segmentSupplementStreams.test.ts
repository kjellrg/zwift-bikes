import { describe, expect, it } from 'vitest'
import { expectedSupplementLengthM, resolveSupplementTracks, supplementTrackLengthMismatch } from './segmentSupplementStreams'
import type { SupplementStreamsFile } from './segmentSupplementStreams'
import { SUPPLEMENT_SEGMENT_STRAVA_IDS } from '../data/segmentStravaIdSupplement'

/** A straight track of this many metres, sampled every 10 m. */
function straightTrack(lengthM: number) {
  const distance = [...Array.from({ length: Math.ceil(lengthM / 10) }, (_, i) => i * 10), lengthM]
  return { latlng: distance.map(d => [0, d / 111_195] as [number, number]), distance, altitude: distance.map(() => 0) }
}
const fetched = (track: ReturnType<typeof straightTrack>) => ({ ...track, fetchedAt: '2026-10-10' })

describe('supplementTrackLengthMismatch', () => {
  it('trusts a track within the matcher\'s 20 % of the expected length', () => {
    expect(supplementTrackLengthMismatch(straightTrack(320), 320)).toBeUndefined()
    expect(supplementTrackLengthMismatch(straightTrack(250), 288)).toBeUndefined()
  })

  it('names the lengths when a track is more than 20 % off - Prime\'s 197 m against Prime Rev\'s 288 m', () => {
    expect(supplementTrackLengthMismatch(straightTrack(197), 288)).toBe('track is 197 m against the 288 m expected (32 % off)')
  })

  it('never fits when there is no length to check against', () => {
    expect(supplementTrackLengthMismatch(straightTrack(197), undefined)).toMatch(/no length to check it against/)
  })
})

describe('expectedSupplementLengthM', () => {
  it('is the record\'s distance, in metres', () => {
    expect(expectedSupplementLengthM({ segment: 'prime-rev' })).toBe(288)
  })

  it('is the entry\'s measured length where the game\'s label is known wrong - Castle Park Sprint', () => {
    expect(expectedSupplementLengthM({ segment: 'castle-park-sprint', measuredLengthM: 220 })).toBe(220)
  })

  it('is undefined for a slug with no record', () => {
    expect(expectedSupplementLengthM({ segment: 'no-such-segment' })).toBeUndefined()
  })
})

describe('resolveSupplementTracks', () => {
  const pave = SUPPLEMENT_SEGMENT_STRAVA_IDS.find(e => e.segment === 'pave-sprint')!
  const prime = SUPPLEMENT_SEGMENT_STRAVA_IDS.find(e => e.segment === 'prime')!

  it('gives a fetched track to its slug, by Strava id', () => {
    const track = fetched(straightTrack(333))
    const { tracks, unfetched } = resolveSupplementTracks({ [pave.stravaSegmentId]: track })
    expect(tracks['pave-sprint']).toBe(track)
    expect(unfetched['pave-sprint']).toBeUndefined()
  })

  it('rejects a track whose length is more than 20 % off the record, naming the id - Prime Rev\'s 288 m under Prime\'s 197 m', () => {
    const { tracks, rejected } = resolveSupplementTracks({ [prime.stravaSegmentId]: fetched(straightTrack(288)) })
    expect(tracks['prime']).toBeUndefined()
    expect(rejected['prime']).toEqual({
      reason: 'supplement-track-length',
      detail: `Strava segment ${prime.stravaSegmentId}'s track is 288 m against the 197 m expected (46 % off), so it is not trusted - see the Prime/Breakaway Brae swapped-id caution in #274`
    })
  })

  it('checks a track against the entry\'s measured length where the game\'s label is known wrong', () => {
    const castle = SUPPLEMENT_SEGMENT_STRAVA_IDS.find(e => e.segment === 'castle-park-sprint')!
    expect(castle.measuredLengthM).toBe(220)
    const accepted = resolveSupplementTracks({ [castle.stravaSegmentId]: fetched(straightTrack(210)) })
    expect(accepted.tracks['castle-park-sprint']).toBeDefined()
    // The game's 320 m label would have fitted the record, and is now refused.
    const refused = resolveSupplementTracks({ [castle.stravaSegmentId]: fetched(straightTrack(320)) })
    expect(refused.rejected['castle-park-sprint']?.detail).toMatch(/320 m against the 220 m expected/)
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
