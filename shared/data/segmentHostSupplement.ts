/**
 * Host routes the game dictionary gives a segment and the `zwift-data` npm
 * package doesn't have yet - the segment twin of `frameSupplement.ts`, with
 * the same lifecycle: `getRoutesWithMeta` merges each entry into its route's
 * `segments` membership, and once a package release ships the same pair the
 * package wins - the merge skips the entry and `segmentHostSupplement.test.ts`
 * fails naming it, so it can be deleted. An entry only ever ADDS a host; no
 * host the package has is removed (#273).
 *
 * Every entry here is a FORWARD segment, and each is the dictionary's
 * `onRoutes` for that segment as fetched on 2026-10-09. The forward Castle
 * Park, Ballon and Pavé Sprints, Champion's Sprint and The Clyde Kicker have
 * no Strava id in `zwift-data`, so no track there to place them by; forward
 * Breakaway Brae is held (below). Their hand-found Strava ids are in
 * `segmentStravaIdSupplement.ts` (#274), and each is placed once its track is
 * fetched; until then they are listed on their segment pages without a
 * Placement.
 *
 * ## Direction: where the dictionary and `zwift-data` disagree, zwift-data stands
 *
 * For 14 pairs the dictionary has the opposite direction from `zwift-data`,
 * and ZwiftInsider agrees with `zwift-data` on them, so none of them changes
 * here (decided 2026-10-09, #273):
 *
 * - Village Sprint: Makuri 40, Country to Coastal, Yumezi Grit
 * - Country Sprint: Makuri 40, Country to Coastal
 * - Alley Sprint: Makuri 40
 * - Tidepool Sprint: Kaze Kicker, Mech Isle Mayhem, Urumaze
 * - Shisa Sprint: Urumaze
 * - Ballon Sprint: Sacre Bleu
 * - Prime: Downtown Dolphin
 * - Breakaway Brae: BRAEk-fast Crits and Grits, The Epiloch
 *
 * Three of them are UNRESOLVED, because the route's GPS track disagrees with
 * `zwift-data`:
 *
 * - **Alley Sprint Rev on Makuri 40.** Makuri 40's track rides the forward
 *   `alley-sprint` stream, from 16.02 to 16.41 km; on the reverse stream the
 *   start comes after the end. (Since explained by swapped ids - below.)
 * - **Breakaway Brae Rev on The Epiloch and on BRAEk-fast Crits and Grits.**
 *   `zwift-data`'s two Breakaway Brae Strava ids look swapped: the
 *   `breakaway-brae` id (33620168) has a 622 m stream and the
 *   `breakaway-brae-rev` id (38170246) a 405 m one, while the records say
 *   0.45 and 0.62 km and the dictionary says forward is 450 m and reverse
 *   600 m. The 405 m stream fits The Epiloch cleanly, which points to forward,
 *   as the dictionary says.
 *
 * A track shows which Strava segment a route rides, not which name belongs on
 * it, so with ids possibly swapped upstream these stay as they are and are
 * HELD: the placement generator must not place them.
 *
 * Found while spot-checking this against ZwiftInsider (2026-10-09): the Alley
 * Sprint ids are swapped too. ZwiftInsider's Alley Sprint page links Strava
 * segment 30412903 and its Alley Sprint Reverse page 30412916 ("only 380
 * meters long, not the 480 meters shown in game"); `zwift-data` has
 * `alley-sprint` on 30412916 (a 388 m stream) and `alley-sprint-rev` on
 * 30412903 (415 m). That explains Makuri 40 in `zwift-data`'s favour: its
 * track rides 30412916, which IS the reverse, as its membership says - so
 * the membership stands, and nothing is unresolved about its name. What is
 * wrong is which track carries which name, so every Alley Sprint host is held
 * for the same reason as Breakaway Brae's: both segments stay exactly as
 * they were before #273 placed anything, listed and unplaced, until the ids
 * are fixed upstream or here.
 *
 * The ~47 reverse-direction dictionary pairs that look like noise are out of
 * scope - not here, not in the generator's report.
 */
export interface SupplementSegmentHost {
  /** The segment's `zwift-data` slug. */
  segment: string
  /** The host route's `zwift-data` slug. */
  route: string
  source: string
}

const DICTIONARY_2026_10_09 = 'game dictionary onRoutes, 2026-10-09'

export const SUPPLEMENT_SEGMENT_HOSTS: SupplementSegmentHost[] = [
  { segment: 'castle-park-sprint', route: 'castle-to-castle', source: DICTIONARY_2026_10_09 },
  { segment: 'ballon-sprint', route: 'gentil-8', source: DICTIONARY_2026_10_09 },
  { segment: 'ballon-sprint', route: 'hell-of-the-north', source: DICTIONARY_2026_10_09 },
  { segment: 'ballon-sprint', route: 'knights-of-the-roundabout', source: DICTIONARY_2026_10_09 },
  { segment: 'pave-sprint', route: 'knights-of-the-roundabout', source: DICTIONARY_2026_10_09 },
  { segment: 'pave-sprint', route: 'sacre-bleu', source: DICTIONARY_2026_10_09 },
  { segment: 'champions-sprint', route: 'outer-scotland', source: DICTIONARY_2026_10_09 },
  { segment: 'the-clyde-kicker', route: 'outer-scotland', source: DICTIONARY_2026_10_09 },
  { segment: 'breakaway-brae', route: 'outer-scotland', source: DICTIONARY_2026_10_09 }
]

/**
 * Segments the placement generator must not place on any host, each with its
 * reason; it reports every such host as unplaced with that reason.
 */
export interface HeldSegment {
  segment: string
  reason: string
}

const BREAKAWAY_BRAE_IDS_SWAPPED = 'zwift-data\'s two Breakaway Brae Strava ids look swapped (the forward id\'s stream is 622 m, the reverse id\'s 405 m; the dictionary says forward is 450 m and reverse 600 m), so neither track can say which name a route rides'
const ALLEY_SPRINT_IDS_SWAPPED = 'zwift-data\'s two Alley Sprint Strava ids are swapped against ZwiftInsider\'s (forward 30412903, reverse 30412916, the 380 m one), so neither track can say which name a route rides'

export const HELD_SEGMENTS: HeldSegment[] = [
  { segment: 'alley-sprint', reason: ALLEY_SPRINT_IDS_SWAPPED },
  { segment: 'alley-sprint-rev', reason: ALLEY_SPRINT_IDS_SWAPPED },
  { segment: 'breakaway-brae', reason: BREAKAWAY_BRAE_IDS_SWAPPED },
  { segment: 'breakaway-brae-rev', reason: BREAKAWAY_BRAE_IDS_SWAPPED }
]

/** Why this segment is held, if it is. */
export function heldReason(segment: string): string | undefined {
  return HELD_SEGMENTS.find(h => h.segment === segment)?.reason
}

/**
 * The segments the supplement adds to this route: its entries for the route
 * that the route's own membership doesn't already have (the package wins).
 * In `SUPPLEMENT_SEGMENT_HOSTS` order, to go after the package's own.
 */
export function supplementHostsFor(route: { slug: string, segments?: readonly string[] }): string[] {
  return SUPPLEMENT_SEGMENT_HOSTS
    .filter(host => host.route === route.slug && !route.segments?.includes(host.segment))
    .map(host => host.segment)
}

/** Whether this host comes from the supplement rather than the package. */
export function isSupplementHost(segment: string, route: string): boolean {
  return SUPPLEMENT_SEGMENT_HOSTS.some(host => host.segment === segment && host.route === route)
}

/**
 * The supplement entries a package's routes already carry - the same slug,
 * so the same direction, in the route's `segments` membership. The package
 * wins: each one named here is to be deleted.
 */
export function supplementHostsThePackageShips(packageRoutes: ReadonlyArray<{ slug: string, segments?: readonly string[] }>): SupplementSegmentHost[] {
  return SUPPLEMENT_SEGMENT_HOSTS.filter(entry => packageRoutes.some(r => r.slug === entry.route && r.segments?.includes(entry.segment)))
}
