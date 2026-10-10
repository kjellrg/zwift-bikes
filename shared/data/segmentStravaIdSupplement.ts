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
 * ## Downtown Dolphin's Prime: the fetched length decided
 *
 * ZwiftInsider's "Downtown Dolphin Prime Sprint" is 38170270. Downtown Dolphin
 * and Bell Lap host `prime-rev` in `zwift-data` (288 m, a sprint); forward
 * `prime` is 197 m and a climb. The fetched track is 200 m, so the id is
 * `prime`'s, and the entry sits there. Matched to the route tracks, Downtown
 * Dolphin rides it forward at 0.88-1.08 km and Bell Lap rides it the other
 * way - so by its track Downtown Dolphin hosts forward Prime, as the game
 * dictionary says and `zwift-data` does not. That is a direction question
 * (#273 leaves direction with `zwift-data`), recorded here and not acted on:
 * no route hosts `prime`, so the track places nothing yet.
 *
 * ## Where the game's label is not the segment's length
 *
 * The length check compares a fetched track to the record's distance, which
 * is the game's label. Castle Park Sprint is labelled 320 m in both
 * directions, and ZwiftInsider - which links the same two ids - says each is
 * really about 210-220 m; the fetched tracks are 210 and 218 m, and they sit
 * on every host route's track. Such an entry carries `measuredLengthM` with
 * the evidence in its note, and the check uses that instead.
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
  /**
   * The length the Strava segment measures, in metres, where the record's
   * in-game length is known to be wrong - with the evidence in `note`. The
   * length check compares the fetched track to this instead of the record.
   */
  measuredLengthM?: number
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
    measuredLengthM: 220,
    note: 'ZwiftInsider links this id and says the sprint is labelled 320 m in game but is only ~220 m long; the fetched track is 210 m. Both directions are labelled 320 m, so the length check could never tell them apart; the matcher\'s heading rule does.'
  },
  {
    segment: 'castle-park-sprint-rev',
    stravaSegmentId: 38168847,
    source: BY_HAND_2026_10_10,
    measuredLengthM: 210,
    note: 'ZwiftInsider links this id and says the sprint is labelled 320 m in game but is only ~210 m long; the fetched track is 218 m. Both directions are labelled 320 m, so the length check could never tell them apart; the matcher\'s heading rule does.'
  },
  { segment: 'pave-sprint', stravaSegmentId: 24710565, source: BY_HAND_2026_10_10 },
  { segment: 'pave-sprint-rev', stravaSegmentId: 24710570, source: BY_HAND_2026_10_10 },
  { segment: 'champions-sprint', stravaSegmentId: 38170243, source: BY_HAND_2026_10_10 },
  { segment: 'the-clyde-kicker', stravaSegmentId: 38170244, source: BY_HAND_2026_10_10 },
  {
    segment: 'prime',
    stravaSegmentId: 38170270,
    source: BY_HAND_2026_10_10,
    note: 'ZwiftInsider\'s "Downtown Dolphin Prime Sprint", 0.2 km. The fetched track is 200 m, so it is forward `prime` (197 m), not `prime-rev` (288 m); it was entered under `prime-rev` until the fetch decided. No zwift-data route hosts `prime`, so it places nothing until one does - see the header.'
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
  { segment: 'country-sprint', reason: 'Country Sprint forward has no Strava segment - too short for Strava\'s minimum segment length, as ZwiftInsider\'s page for it also says (checked 2026-10-10) - so no track to place it by' }
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
