import { segments } from 'zwift-data'
import type { Track } from './segmentMatching'
import { MAX_LENGTH_ERROR } from './segmentMatching'
import { SUPPLEMENT_SEGMENT_STRAVA_IDS } from '../data/segmentStravaIdSupplement'

/**
 * `shared/data/segmentStreams.supplement.json`: the Strava streams fetched
 * for `SUPPLEMENT_SEGMENT_STRAVA_IDS` by `npm run segment-streams:fetch`,
 * rounded as `zwift-data/streams` rounds its own (latlng to 6 decimals,
 * distance and altitude to 1) and keyed by Strava id, so moving an id to
 * another slug costs no refetch (#274). Read only by the placement generator
 * and its tests - passed in, never imported here, so it cannot reach the app.
 */
export interface SupplementStreamsFile {
  [stravaSegmentId: string]: {
    latlng: Array<[number, number]>
    distance: number[]
    altitude: number[]
    /** The day it was fetched, `YYYY-MM-DD`. */
    fetchedAt: string
  }
}

export interface RejectedSupplementTrack {
  reason: 'supplement-track-length'
  detail: string
}

export interface ResolvedSupplementTracks {
  /** The tracks the placer may use, keyed by segment slug. */
  tracks: Record<string, Track>
  /** Fetched tracks the length check refused, keyed by segment slug. */
  rejected: Record<string, RejectedSupplementTrack>
  /** Entries with an id but no fetched track yet: slug to Strava id. */
  unfetched: Record<string, number>
}

/**
 * The matcher's own 20 % length rule (`MAX_LENGTH_ERROR`, #273), applied to
 * the whole fetched track against the record's distance. A hand-picked id is
 * chosen by its name, and a name can be on the wrong direction's segment
 * (`zwift-data`'s Alley Sprint and Breakaway Brae ids are swapped); where the
 * two directions differ in length, the length is what catches it.
 */
const recordDistanceKm = new Map(segments.map(segment => [segment.slug, segment.distance]))

/**
 * The length a supplement entry's track should measure: the record's
 * distance (the game's label), or the entry's `measuredLengthM` where the
 * label is known to be wrong.
 */
export function expectedSupplementLengthM(entry: { segment: string, measuredLengthM?: number }): number | undefined {
  if (entry.measuredLengthM) return entry.measuredLengthM
  const km = recordDistanceKm.get(entry.segment)
  return km === undefined ? undefined : km * 1000
}

/**
 * Why a fetched track's length does not fit the length expected of it (the
 * track's span, last `distance` less the first, as the matcher measures it),
 * or `undefined` if it is within `MAX_LENGTH_ERROR`. No expected length means
 * nothing to check against, so it never fits.
 */
export function supplementTrackLengthMismatch(track: Track, expectedM: number | undefined): string | undefined {
  const trackM = (track.distance.at(-1) ?? 0) - (track.distance[0] ?? 0)
  if (!expectedM || expectedM <= 0) return `track is ${Math.round(trackM)} m; there is no length to check it against`
  const error = Math.abs(trackM - expectedM) / expectedM
  if (error <= MAX_LENGTH_ERROR) return undefined
  return `track is ${Math.round(trackM)} m against the ${Math.round(expectedM)} m expected (${Math.round(error * 100)} % off)`
}

/**
 * Resolves the fetched supplement streams into tracks the placer can use,
 * keyed by slug: each entry of `SUPPLEMENT_SEGMENT_STRAVA_IDS` takes the
 * track fetched for its id if the length check passes, is rejected if it
 * fails, and is unfetched if there is no track for its id yet. The package
 * wins: a slug `zwift-data/streams` already tracks (`packageSegmentTracks`)
 * takes no supplement track and is in none of the three.
 */
export function resolveSupplementTracks(
  fetched: SupplementStreamsFile,
  packageSegmentTracks: Readonly<Record<string, Track | undefined>> = {}
): ResolvedSupplementTracks {
  const resolved: ResolvedSupplementTracks = { tracks: {}, rejected: {}, unfetched: {} }
  for (const entry of SUPPLEMENT_SEGMENT_STRAVA_IDS) {
    const { segment, stravaSegmentId } = entry
    if (packageSegmentTracks[segment]) continue
    const track = fetched[stravaSegmentId]
    if (!track) {
      resolved.unfetched[segment] = stravaSegmentId
      continue
    }
    const mismatch = supplementTrackLengthMismatch(track, expectedSupplementLengthM(entry))
    if (mismatch) {
      resolved.rejected[segment] = {
        reason: 'supplement-track-length',
        detail: `Strava segment ${stravaSegmentId}'s ${mismatch}, so it is not trusted - see the Prime/Breakaway Brae swapped-id caution in #274`
      }
      continue
    }
    resolved.tracks[segment] = track
  }
  return resolved
}
