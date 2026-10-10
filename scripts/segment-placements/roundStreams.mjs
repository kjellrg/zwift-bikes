// Rounds a Strava segment's streams the way `zwift-data/streams` ships its
// own (node_modules/zwift-data/lib/streams/types.d.ts): latlng to 6 decimals,
// distance and altitude to 1. A fetched supplement track (#274) is then in
// the same precision as every track the matcher was calibrated on, and the
// committed file stays small.

/** @param {number} value @param {number} decimals */
function round(value, decimals) {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}

/**
 * @param {{ latlng: ReadonlyArray<readonly [number, number]>, distance: ReadonlyArray<number>, altitude?: ReadonlyArray<number> }} streams
 * @returns {{ latlng: Array<[number, number]>, distance: number[], altitude: number[] }}
 *   `altitude` is empty when Strava sent none - a few segments lack it, and
 *   the placer reads only latlng and distance.
 */
export function roundStravaStreams({ latlng, distance, altitude }) {
  return {
    latlng: latlng.map(([lat, lng]) => [round(lat, 6), round(lng, 6)]),
    distance: distance.map(d => round(d, 1)),
    altitude: (altitude ?? []).map(a => round(a, 1))
  }
}
