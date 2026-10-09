/**
 * A recorded track: index-aligned `[lat, lng]` points and the cumulative
 * distance in metres at each, the shape `zwift-data/streams` ships for a
 * route or a segment.
 */
export interface Track {
  readonly latlng: ReadonlyArray<readonly [number, number]>
  readonly distance: ReadonlyArray<number>
}

/** Where a segment's start and end fall on a route track, in km from the track's first point. */
export interface TrackPlacement {
  fromKm: number
  toKm: number
}

/** Why a segment could not be placed on a route track: the rule it failed, with the numbers. */
export interface TrackRejection {
  rule: 'start-off-track' | 'end-off-track' | 'direction' | 'order' | 'length'
  detail: string
}

export interface TrackMatch {
  placements: TrackPlacement[]
  rejection?: TrackRejection
}

/** How far a segment's start or end may sit from the route's polyline. */
export const MAX_OFF_TRACK_M = 25

/**
 * How far the placed length may differ from the segment track's own length,
 * as a fraction of it. A forward and a reverse sprint share a finish line, so
 * a route riding one has the other's end on its track too; the length is
 * what rejects the wrong one.
 */
export const MAX_LENGTH_ERROR = 0.2

/**
 * How far the route's heading where it passes a segment's start or end may
 * turn from the segment's own heading there. A pass outside it rides the
 * other way: the far carriageway of a wide road (the Champs-Élysées' two
 * sides are within 25 m) or the same road in the reverse direction.
 */
const MAX_HEADING_TURN_DEG = 90

/** The stretch either side of a point that its heading is taken over. */
const HEADING_SPAN_M = 15

/**
 * Two placements that overlap by no more than this are back-to-back passes
 * whose shared boundary was located a few metres apart, not two claims on
 * the same stretch (London Loop's laps on The PRL Full).
 */
const OVERLAP_SLACK_M = 2 * MAX_OFF_TRACK_M

const EARTH_RADIUS_M = 6_371_008.8

interface Projection {
  /** Metres from the point to the route's polyline. */
  offM: number
  /** Metres along the route track where the point projects. */
  alongM: number
}

/**
 * The point's projection onto each edge of the route, flattened onto a local
 * plane around the edge (exact enough over one ~50 m edge). Measured to the
 * line between points rather than to the nearest point, because route points
 * can be 53 m apart.
 */
function projectOntoEdges(route: Track, point: readonly [number, number]): Projection[] {
  const out: Projection[] = []
  for (let i = 0; i < route.latlng.length - 1; i++) {
    const a = route.latlng[i]!
    const b = route.latlng[i + 1]!
    const cosLat = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
    const toXY = (p: readonly [number, number]) => [
      (p[1] - a[1]) * Math.PI / 180 * EARTH_RADIUS_M * cosLat,
      (p[0] - a[0]) * Math.PI / 180 * EARTH_RADIUS_M
    ] as const
    const [bx, by] = toXY(b)
    const [px, py] = toXY(point)
    const edgeSq = bx * bx + by * by
    const t = edgeSq > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / edgeSq)) : 0
    const fromA = route.distance[i]!
    out.push({
      offM: Math.hypot(px - t * bx, py - t * by),
      alongM: fromA + t * (route.distance[i + 1]! - fromA)
    })
  }
  return out
}

/**
 * Each place the route comes within `MAX_OFF_TRACK_M` of a point: every
 * local closest approach, so a loop whose end meets its start yields two (km
 * 0 and the lap end) and a route that laps a circuit yields one per lap. A
 * recording that dwells by a point (Dust in the Wind's first Titans Grove
 * finish wanders within 25 m of it for 150 m, nearest at 1 m and again at
 * 3 m) yields several, and the length fit chooses among them.
 */
function passesNear(projections: Projection[]): Projection[] {
  return projections.filter((p, i) => p.offM <= MAX_OFF_TRACK_M
    && p.offM <= (projections[i - 1]?.offM ?? Infinity)
    && p.offM < (projections[i + 1]?.offM ?? Infinity))
}

/** The track's position `m` metres along it, interpolated between points. */
function pointAt(track: Track, m: number): readonly [number, number] {
  const d = track.distance
  const target = Math.min(Math.max(m, d[0]!), d[d.length - 1]!)
  let i = 0
  while (i < d.length - 2 && d[i + 1]! < target) i++
  const span = d[i + 1]! - d[i]!
  const t = span > 0 ? (target - d[i]!) / span : 0
  const a = track.latlng[i]!
  const b = track.latlng[i + 1]!
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
}

/** Compass heading, in degrees, of the track between `fromM` and `toM` along it. */
function headingBetween(track: Track, fromM: number, toM: number): number {
  const a = pointAt(track, fromM)
  const b = pointAt(track, toM)
  const east = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
  return Math.atan2(east, b[0] - a[0]) * 180 / Math.PI
}

function turnDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function ridesTheSameWay(route: Track, pass: Projection, segmentHeading: number): boolean {
  return turnDeg(headingBetween(route, pass.alongM - HEADING_SPAN_M, pass.alongM + HEADING_SPAN_M), segmentHeading) <= MAX_HEADING_TURN_DEG
}

function nearest(projections: Projection[]): Projection {
  return projections.reduce((best, p) => (p.offM < best.offM ? p : best))
}

/**
 * Where a route track rides a segment's track: every pass, in km along the
 * route track from its first point.
 *
 * Every start the route passes is paired with every end after it, and a pair
 * qualifies when the length it spans is within `MAX_LENGTH_ERROR` of the
 * segment track's. The qualifying pairs are then taken best fit first,
 * skipping any that overlaps one already taken - so a lap-marker segment
 * whose start and end are the same point spans the lap rather than nothing,
 * and a route that passes near a long segment's start a kilometre early
 * (Fuego Flats Rev on Flat Out Fast) still gets the pass that fits.
 *
 * Nothing placed means a rejection naming the rule that failed and its
 * numbers: the closest approaches when an end is off the track or no end
 * follows a start, the pair nearest the segment's length otherwise.
 */
export function placeSegmentOnTrack(route: Track, segment: Track): TrackMatch {
  const startProjections = projectOntoEdges(route, segment.latlng[0]!)
  const endProjections = projectOntoEdges(route, segment.latlng[segment.latlng.length - 1]!)
  const startPasses = passesNear(startProjections)
  const endPasses = passesNear(endProjections)
  if (!startPasses.length) return offTrack('start', nearest(startProjections).offM)
  if (!endPasses.length) return offTrack('end', nearest(endProjections).offM)

  const segmentStartM = segment.distance[0]!
  const segmentEndM = segment.distance[segment.distance.length - 1]!
  const segmentM = segmentEndM - segmentStartM
  const starts = startPasses.filter(p => ridesTheSameWay(route, p, headingBetween(segment, segmentStartM, segmentStartM + 2 * HEADING_SPAN_M)))
  const ends = endPasses.filter(p => ridesTheSameWay(route, p, headingBetween(segment, segmentEndM - 2 * HEADING_SPAN_M, segmentEndM)))
  if (!starts.length) return otherWay('start', nearest(startPasses))
  if (!ends.length) return otherWay('end', nearest(endPasses))

  const fits: { fromM: number, toM: number, error: number }[] = []
  let closest: { placedM: number, error: number } | undefined
  for (const start of starts) {
    for (const end of ends) {
      if (end.alongM <= start.alongM) continue
      const placedM = end.alongM - start.alongM
      const error = Math.abs(placedM - segmentM) / segmentM
      if (error <= MAX_LENGTH_ERROR) fits.push({ fromM: start.alongM, toM: end.alongM, error })
      else if (!closest || error < closest.error) closest = { placedM, error }
    }
  }

  const taken: typeof fits = []
  for (const fit of fits.sort((x, y) => x.error - y.error)) {
    if (!taken.some(t => fit.fromM < t.toM - OVERLAP_SLACK_M && t.fromM < fit.toM - OVERLAP_SLACK_M)) taken.push(fit)
  }
  if (taken.length) {
    return { placements: taken.sort((x, y) => x.fromM - y.fromM).map(t => ({ fromKm: t.fromM / 1000, toKm: t.toM / 1000 })) }
  }

  if (!closest) {
    const start = nearest(starts)
    const end = nearest(ends)
    return { placements: [], rejection: { rule: 'order', detail: `the start (${km(start.alongM)} km) comes after the end (${km(end.alongM)} km)` } }
  }
  return {
    placements: [],
    rejection: { rule: 'length', detail: `the placed length (${Math.round(closest.placedM)} m) is ${Math.round(closest.error * 100)}% off the segment track's ${Math.round(segmentM)} m (limit ${MAX_LENGTH_ERROR * 100}%)` }
  }
}

function otherWay(which: 'start' | 'end', pass: Projection): TrackMatch {
  return { placements: [], rejection: { rule: 'direction', detail: `the route passes the ${which} (${km(pass.alongM)} km) only riding the other way` } }
}

function offTrack(which: 'start' | 'end', offM: number): TrackMatch {
  return {
    placements: [],
    rejection: { rule: `${which}-off-track`, detail: `${which} is ${Math.round(offM)} m from the route track (limit ${MAX_OFF_TRACK_M} m)` }
  }
}

function km(m: number): string {
  return (m / 1000).toFixed(3)
}
