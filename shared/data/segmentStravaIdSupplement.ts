/**
 * Strava segment ids, found by hand, for segments the `zwift-data` npm
 * package has none for - so no track in `zwift-data/streams`, and none of
 * their Host routes can be given a Placement (#274). The id twin of
 * `segmentHostSupplement.ts`, with the same lifecycle: once a package release
 * gives the slug a Strava id of its own (the same one or a different one -
 * either way a human decides which is right) or ships a track for it, the
 * package wins, and `segmentStravaIdSupplement.test.ts` fails naming the
 * entry, so it can be deleted.
 *
 * Every id was picked by hand on Strava by the maintainer on 2026-10-10,
 * with the direction read from the segment's name. A name can be wrong, as
 * `zwift-data`'s own swapped Alley Sprint and Breakaway Brae ids show
 * (`HELD_SEGMENTS`), so every fetched track's length is checked against the
 * record's before it is used (`supplementTrackLengthMismatch`).
 *
 * The tracks themselves live in `shared/data/segmentStreams.supplement.json`,
 * keyed by Strava id, fetched once by `npm run segment-streams:fetch` and
 * committed, so neither CI nor `npm run segment-placements:compute` ever
 * needs a Strava token. Keyed by id rather than slug, so moving an id to
 * another slug costs no refetch.
 *
 * ## Downtown Dolphin's Prime: which direction is open
 *
 * The maintainer labelled 38170270 "Downtown Dolphin Prime Sprint". Downtown
 * Dolphin hosts `prime-rev` in `zwift-data` (288 m, a sprint); forward
 * `prime` is 197 m and a climb. It is entered under `prime-rev`, and the
 * fetched length decides: if the track comes back near 197 m the length check
 * rejects it here, and the entry moves to `prime`.
 *
 * ## Not entered
 *
 * - **Country Sprint forward** (`country-sprint`) has no Strava segment: the
 *   maintainer found none, as it is too short for Strava. It is in
 *   `NO_STRAVA_SEGMENT`, so its hosts are reported unplaced for that reason
 *   rather than for a missing id.
 * - **The Clyde Kicker Reverse** is Strava segment 33636632, but neither
 *   `zwift-data` nor the game dictionary has that segment, so there is no slug
 *   to enter it under. Recorded here for when one of them adds it.
 */
export interface SupplementSegmentStravaId {
  /** The segment's `zwift-data` slug. */
  segment: string
  stravaSegmentId: number
  source: string
  note?: string
}

const BY_HAND_2026_10_10 = 'picked by hand on Strava by the maintainer, 2026-10-10; direction read from the segment name'

export const SUPPLEMENT_SEGMENT_STRAVA_IDS: SupplementSegmentStravaId[] = [
  { segment: 'village-sprint', stravaSegmentId: 38168903, source: BY_HAND_2026_10_10 },
  { segment: 'village-sprint-rev', stravaSegmentId: 38168897, source: BY_HAND_2026_10_10 },
  { segment: 'country-sprint-rev', stravaSegmentId: 38168940, source: BY_HAND_2026_10_10 },
  { segment: 'shisa-sprint', stravaSegmentId: 38168992, source: BY_HAND_2026_10_10 },
  { segment: 'shisa-sprint-rev', stravaSegmentId: 38169009, source: BY_HAND_2026_10_10 },
  {
    segment: 'castle-park-sprint',
    stravaSegmentId: 38168855,
    source: BY_HAND_2026_10_10,
    note: 'Both directions are 320 m, so the length check cannot tell them apart; the matcher\'s heading rule does.'
  },
  {
    segment: 'castle-park-sprint-rev',
    stravaSegmentId: 38168847,
    source: BY_HAND_2026_10_10,
    note: 'Both directions are 320 m, so the length check cannot tell them apart; the matcher\'s heading rule does.'
  },
  { segment: 'pave-sprint', stravaSegmentId: 24710565, source: BY_HAND_2026_10_10 },
  { segment: 'pave-sprint-rev', stravaSegmentId: 24710570, source: BY_HAND_2026_10_10 },
  { segment: 'champions-sprint', stravaSegmentId: 38170243, source: BY_HAND_2026_10_10 },
  { segment: 'the-clyde-kicker', stravaSegmentId: 38170244, source: BY_HAND_2026_10_10 },
  {
    segment: 'prime-rev',
    stravaSegmentId: 38170270,
    source: BY_HAND_2026_10_10,
    note: 'Labelled "Downtown Dolphin Prime Sprint". The fetched length decides: a track near 197 m is forward `prime`, and the entry moves there.'
  },
  { segment: 'tidepool-sprint', stravaSegmentId: 38169050, source: BY_HAND_2026_10_10 },
  { segment: 'boardwalk-sprint', stravaSegmentId: 38169040, source: BY_HAND_2026_10_10 },
  { segment: 'ballon-sprint', stravaSegmentId: 38169142, source: BY_HAND_2026_10_10 }
]

/** Segments known to have no Strava segment at all, each with the reason; their hosts are reported unplaced with it. */
export interface NoStravaSegment {
  segment: string
  reason: string
}

export const NO_STRAVA_SEGMENT: NoStravaSegment[] = [
  { segment: 'country-sprint', reason: 'Country Sprint forward has no Strava segment - too short for Strava (checked by hand, 2026-10-10) - so no track to place it by' }
]

/** The hand-found Strava id for this segment, if there is one. */
export function supplementStravaIdFor(segment: string): SupplementSegmentStravaId | undefined {
  return SUPPLEMENT_SEGMENT_STRAVA_IDS.find(entry => entry.segment === segment)
}

/** Why this segment has no Strava segment, if it is known to have none. */
export function noStravaSegmentReason(segment: string): string | undefined {
  return NO_STRAVA_SEGMENT.find(entry => entry.segment === segment)?.reason
}

/**
 * The entries the package has caught up with: the slug now has a Strava id
 * upstream (the same one or a different one - either way a human decides)
 * or `zwift-data/streams` ships a track for it. The package wins: each one
 * named here is to be deleted.
 */
export function supplementIdsThePackageShips(
  packageSegments: ReadonlyArray<{ slug: string, stravaSegmentId?: number }>,
  packageStreamSlugs: Iterable<string>
): SupplementSegmentStravaId[] {
  const tracked = new Set(packageStreamSlugs)
  return SUPPLEMENT_SEGMENT_STRAVA_IDS.filter(entry =>
    tracked.has(entry.segment) || packageSegments.some(s => s.slug === entry.segment && s.stravaSegmentId !== undefined))
}
