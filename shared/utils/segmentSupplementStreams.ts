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
 * Why a fetched track's length does not fit the record's distance (the track's
 * span, last `distance` less the first, as the matcher measures it), or
 * `undefined` if it is within `MAX_LENGTH_ERROR`. A record with no distance
 * cannot be checked against, so it never fits.
 */
export function supplementTrackLengthMismatch(track: Track, recordKm: number | undefined): string | undefined {
  const trackM = (track.distance.at(-1) ?? 0) - (track.distance[0] ?? 0)
  if (!recordKm || recordKm <= 0) return `track is ${Math.round(trackM)} m; the record has no distance to check it against`
  const recordM = recordKm * 1000
  const error = Math.abs(trackM - recordM) / recordM
  if (error <= MAX_LENGTH_ERROR) return undefined
  return `track is ${Math.round(trackM)} m; the record says ${Math.round(recordM)} m (${Math.round(error * 100)} % off)`
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
  for (const { segment, stravaSegmentId } of SUPPLEMENT_SEGMENT_STRAVA_IDS) {
    if (packageSegmentTracks[segment]) continue
    const track = fetched[stravaSegmentId]
    if (!track) {
      resolved.unfetched[segment] = stravaSegmentId
      continue
    }
    const mismatch = supplementTrackLengthMismatch(track, recordDistanceKm.get(segment))
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
