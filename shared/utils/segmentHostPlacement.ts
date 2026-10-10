import { routes, segments } from 'zwift-data'
import type { Track, TrackRejection } from './segmentMatching'
import { placeSegmentOnTrack } from './segmentMatching'
import { placementsAreRideRelative } from './routeClimbs'
import { getGeneratedRouteSurface } from '../data/routeSurfaces'
import { heldReason, supplementHostsFor } from '../data/segmentHostSupplement'

/** One generated Placement, in the shape of a `zwift-data` `segmentsOnRoute` entry: km from the lap start. */
export interface GeneratedSegmentPlacement {
  segment: string
  from: number
  to: number
}

export interface UnplacedSegmentHost {
  route: string
  segment: string
  /** `held`, a missing track, a ride-relative route, or the matching rule that failed (`TrackRejection`). */
  reason: 'held' | 'no-segment-track' | 'no-route-track' | 'ride-relative-route' | TrackRejection['rule']
  detail: string
}

/** What `npm run segment-placements:compute` commits to `shared/data/segmentPlacements.generated.json`. */
export interface SegmentPlacementsFile {
  /** Keyed by route slug, in ride order. */
  placements: Record<string, GeneratedSegmentPlacement[]>
  unplaced: UnplacedSegmentHost[]
}

/** The recorded tracks `zwift-data/streams` ships, keyed by slug. Passed in so the 34 MB package never reaches the app bundle. */
export interface StreamTracks {
  routes: Readonly<Record<string, Track | undefined>>
  segments: Readonly<Record<string, Track | undefined>>
}

const segmentsBySlug = new Map(segments.map(segment => [segment.slug, segment]))

/** Km rounded to the metre, as `zwift-data` writes `segmentsOnRoute`. */
function roundKm(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Whether a route is ride-relative for placing on: its placements or its
 * track run from the ride start rather than the lap start. Generated
 * placements are lap-relative - the frame `zwift-data` uses on almost every
 * route, so `traceScale` applies to them unchanged - and a route whose own
 * placements are ride-relative would end up with two frames mixed in one
 * `segmentsOnRoute`. Wider than `placementsAreRideRelative`, which answers
 * only for a route that has placements: a route with none whose recorded
 * trace covered the lead-in would read as ride-relative the moment a
 * generated placement landed on it. Such a route is not placed on.
 */
function isRideRelativeForPlacing(route: (typeof routes)[number]): boolean {
  return placementsAreRideRelative(route) || ((route.leadInDistance ?? 0) > 0 && !!getGeneratedRouteSurface(route.slug)?.traceCoveredLeadIn)
}

/**
 * Places every Host route `zwift-data` has not placed, by matching the
 * segment's recorded track to the route's (`placeSegmentOnTrack`), and
 * reports every host it could not place with the reason (#273).
 *
 * The hosts are each route's `zwift-data` membership plus
 * `SUPPLEMENT_SEGMENT_HOSTS`, sprints and climbs only (the lap markers are
 * never ranked or listed). A pair `zwift-data` has placed is skipped
 * entirely - its placement wins - and a held pair is reported, never matched.
 */
export function placeSegmentHosts(tracks: StreamTracks): SegmentPlacementsFile {
  const placements: Record<string, GeneratedSegmentPlacement[]> = {}
  const unplaced: UnplacedSegmentHost[] = []

  for (const route of routes) {
    for (const slug of [...route.segments ?? [], ...supplementHostsFor(route)]) {
      const segment = segmentsBySlug.get(slug)
      if (segment?.type !== 'sprint' && segment?.type !== 'climb') continue
      if (route.segmentsOnRoute?.some(p => p.segment === slug)) continue
      const report = (reason: UnplacedSegmentHost['reason'], detail: string) => unplaced.push({ route: route.slug, segment: slug, reason, detail })

      const held = heldReason(slug)
      if (held) {
        report('held', held)
        continue
      }
      const segmentTrack = tracks.segments[slug]
      if (!segmentTrack) {
        report('no-segment-track', segment.stravaSegmentId ? `zwift-data/streams has no track for Strava segment ${segment.stravaSegmentId}` : 'the segment has no Strava id in zwift-data, so no track')
        continue
      }
      const routeTrack = tracks.routes[route.slug]
      if (!routeTrack) {
        report('no-route-track', 'zwift-data/streams has no track for the route')
        continue
      }
      if (isRideRelativeForPlacing(route)) {
        report('ride-relative-route', 'the route\'s placements and track run from the ride start, and a generated placement is lap-relative')
        continue
      }
      const match = placeSegmentOnTrack(routeTrack, segmentTrack)
      for (const p of match.placements) (placements[route.slug] ??= []).push({ segment: slug, from: roundKm(p.fromKm), to: roundKm(p.toKm) })
      if (match.rejection) report(match.rejection.rule, match.rejection.detail)
    }
    placements[route.slug]?.sort((a, b) => a.from - b.from)
  }

  return { placements, unplaced }
}
