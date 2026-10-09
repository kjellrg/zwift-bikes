import { describe, expect, it } from 'vitest'
import { placeSegmentOnTrack } from './segmentMatching'

// On the equator a degree of longitude is 111,319.5 m, so a track laid along
// it has an exact, hand-checkable length: 0.0001 deg = 11.13 m.
const M_PER_DEG = 111_319.5

/** A track along the equator through these longitudes, `latOffsetM` metres north of it. */
function track(lngs: number[], latOffsetM = 0) {
  const lat = latOffsetM / M_PER_DEG
  let distance = 0
  return {
    latlng: lngs.map(lng => [lat, lng] as const),
    distance: lngs.map((lng, i) => (distance += i === 0 ? 0 : Math.abs(lng - lngs[i - 1]!) * M_PER_DEG))
  }
}

function range(from: number, to: number, step: number) {
  const out: number[] = []
  const n = Math.round(Math.abs(to - from) / step)
  for (let i = 0; i <= n; i++) out.push(from + Math.sign(to - from) * i * step)
  return out
}

// A 1.113 km route riding east, one point every 44.5 m - coarser than the
// segment, the way real route tracks are (spacing reaches 53 m).
const eastbound = track(range(0, 0.01, 0.0004))

describe('placeSegmentOnTrack', () => {
  it('places a segment the route rides through, measured from the route track\'s start', () => {
    // 0.003 -> 0.005 deg: 334 m to 557 m along the route.
    const result = placeSegmentOnTrack(eastbound, track(range(0.003, 0.005, 0.0001)))
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]!.fromKm).toBeCloseTo(0.334, 2)
    expect(result.placements[0]!.toKm).toBeCloseTo(0.557, 2)
  })

  it('reports a start more than 25 m from the route track, with the distance, and places nothing', () => {
    // A parallel road 40 m north, with the end bent back onto the route.
    const segment = track(range(0.003, 0.005, 0.0001), 40)
    const result = placeSegmentOnTrack(eastbound, { ...segment, latlng: [...segment.latlng.slice(0, -1), [0, 0.005]] })
    expect(result.placements).toEqual([])
    expect(result.rejection).toEqual({ rule: 'start-off-track', detail: 'start is 40 m from the route track (limit 25 m)' })
  })

  it('reports an end more than 25 m from the route track', () => {
    const segment = track(range(0.003, 0.005, 0.0001))
    const result = placeSegmentOnTrack(eastbound, { ...segment, latlng: [...segment.latlng.slice(0, -1), [30 / M_PER_DEG, 0.005]] })
    expect(result.placements).toEqual([])
    expect(result.rejection).toEqual({ rule: 'end-off-track', detail: 'end is 30 m from the route track (limit 25 m)' })
  })

  it('reports a route that rides the segment the other way', () => {
    const westbound = track(range(0.01, 0, 0.0004))
    const result = placeSegmentOnTrack(westbound, track(range(0.003, 0.005, 0.0001)))
    expect(result.placements).toEqual([])
    expect(result.rejection).toEqual({ rule: 'direction', detail: 'the route passes the start (0.779 km) only riding the other way' })
  })

  it('reports a start that comes after the end when the route rides each end the right way', () => {
    // The route rides the segment's last stretch, leaves, and comes back for
    // its first stretch: never the whole segment in one go.
    const north = 200 / M_PER_DEG
    const tail = track(range(0.0045, 0.006, 0.0001))
    const head = track(range(0.002, 0.0035, 0.0001))
    const route = {
      latlng: [...tail.latlng, [north, 0.006] as const, [north, 0.002] as const, ...head.latlng],
      distance: [...tail.distance, 166.98 + 200, 166.98 + 200 + 445.28, ...head.distance.map(d => 166.98 + 200 + 445.28 + 200 + d)]
    }
    const result = placeSegmentOnTrack(route, track(range(0.003, 0.005, 0.0001)))
    expect(result.placements).toEqual([])
    expect(result.rejection).toEqual({ rule: 'order', detail: 'the start (1.124 km) comes after the end (0.056 km)' })
  })

  it('places the carriageway riding the segment\'s way, not the one 20 m across riding against it', () => {
    // Out east on the equator, back west 20 m north: both pass the segment's
    // start and end within 25 m, and the lengths match either way.
    const north = 20 / M_PER_DEG
    const lap = range(0, 0.01, 0.0004)
    const east = track(lap)
    const outAndBack = {
      latlng: [...[...lap].reverse().map(lng => [north, lng] as const), ...east.latlng],
      distance: [...east.distance, ...east.distance.map(d => 1133.2 + d)]
    }
    const result = placeSegmentOnTrack(outAndBack, track(range(0.003, 0.005, 0.0001)))
    expect(result.placements.map(p => [+p.fromKm.toFixed(2), +p.toKm.toFixed(2)])).toEqual([[1.47, 1.69]])
  })

  it('reports a placed length more than 20% off the segment track\'s length', () => {
    // A segment that leaves the route for a road 100 m north and comes back:
    // both ends sit on the route, but the route covers 223 m of a 423 m segment.
    const north = 100 / M_PER_DEG
    const detour = { latlng: [[0, 0.003], [north, 0.003], [north, 0.005], [0, 0.005]] as const, distance: [0, 100, 322.6, 422.6] }
    const result = placeSegmentOnTrack(eastbound, detour)
    expect(result.placements).toEqual([])
    expect(result.rejection).toEqual({ rule: 'length', detail: 'the placed length (223 m) is 47% off the segment track\'s 423 m (limit 20%)' })
  })

  it('places a length 15% off the segment track\'s - within the limit', () => {
    const segment = track(range(0.003, 0.005, 0.0001))
    expect(placeSegmentOnTrack(eastbound, { ...segment, distance: segment.distance.map(d => d * 1.15) }).placements).toHaveLength(1)
  })

  it('places every pass of a route that laps the segment', () => {
    // East along the equator, back west on a road 200 m north, east again:
    // the second pass starts 1113 + 200 + 1113 + 200 = 2626 m in.
    const north = 200 / M_PER_DEG
    const lap = range(0, 0.01, 0.0004)
    const east = track(lap)
    const lapped = {
      latlng: [...east.latlng, ...[...lap].reverse().map(lng => [north, lng] as const), ...east.latlng],
      distance: [...east.distance, ...east.distance.map(d => 1313.2 + d), ...east.distance.map(d => 2626.4 + d)]
    }
    const result = placeSegmentOnTrack(lapped, track(range(0.003, 0.005, 0.0001)))
    expect(result.placements.map(p => [+p.fromKm.toFixed(2), +p.toKm.toFixed(2)])).toEqual([[0.33, 0.56], [2.96, 3.18]])
  })

  it('places back-to-back laps of a lap-marker segment, whose start and end are the same point', () => {
    // A closed 2626 m loop ridden twice, and a segment that is the loop itself.
    const north = 200 / M_PER_DEG
    const lap = range(0, 0.01, 0.0004)
    const east = track(lap)
    const loop = {
      latlng: [...east.latlng, ...[...lap].reverse().map(lng => [north, lng] as const)],
      distance: [...east.distance, ...east.distance.map(d => 1313.2 + d)]
    }
    const twice = {
      latlng: [...loop.latlng, ...loop.latlng, [0, 0] as const],
      distance: [...loop.distance, ...loop.distance.map(d => 2626.4 + d), 5252.8]
    }
    const closed = { latlng: [...loop.latlng, [0, 0] as const], distance: [...loop.distance, 2626.4] }
    expect(placeSegmentOnTrack(twice, closed).placements.map(p => [+p.fromKm.toFixed(3), +p.toKm.toFixed(3)])).toEqual([[0, 2.626], [2.626, 5.253]])
  })

  it('ends a segment at the lap end, not at km 0, when the route starts and ends at the same point', () => {
    // A closed loop: east, west on a road 200 m north, then 200 m south back
    // to the start. A segment on that last stretch ends where the route began.
    const north = 200 / M_PER_DEG
    const lap = range(0, 0.01, 0.0004)
    const east = track(lap)
    const loop = {
      latlng: [...east.latlng, ...[...lap].reverse().map(lng => [north, lng] as const), [0, 0] as const],
      distance: [...east.distance, ...east.distance.map(d => 1313.2 + d), 2626.4]
    }
    const closing = { latlng: [[north, 0], [north / 2, 0], [0, 0]] as const, distance: [0, 100, 200] }
    expect(placeSegmentOnTrack(loop, closing).placements.map(p => [+p.fromKm.toFixed(3), +p.toKm.toFixed(3)])).toEqual([[2.426, 2.626]])
  })

  it('places a start and end 20 m off the track - within the limit', () => {
    expect(placeSegmentOnTrack(eastbound, track(range(0.003, 0.005, 0.0001), 20)).placements).toHaveLength(1)
  })
})
