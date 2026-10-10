import { describe, expect, it } from 'vitest'
import * as streams from 'zwift-data/streams'
import { roundStravaStreams } from './roundStreams.mjs'

describe('roundStravaStreams', () => {
  it('rounds latlng to 6 decimals and distance and altitude to 1, as zwift-data/streams does', () => {
    expect(roundStravaStreams({
      latlng: [[-11.6370254, 166.9721389], [-11.63702, 166.97214]],
      distance: [0, 12.34999],
      altitude: [16.0499, 17.25]
    })).toEqual({
      latlng: [[-11.637025, 166.972139], [-11.63702, 166.97214]],
      distance: [0, 12.3],
      altitude: [16, 17.3]
    })
  })

  it('leaves a zwift-data/streams track as it is', () => {
    const track = streams.segments['tidepool-sprint-rev']
    expect(roundStravaStreams({ latlng: track.latlng, distance: track.distance, altitude: track.altitude })).toEqual({
      latlng: track.latlng,
      distance: track.distance,
      altitude: track.altitude
    })
  })

  it('stores no altitude when Strava sends none', () => {
    expect(roundStravaStreams({ latlng: [[1, 2]], distance: [0] })).toEqual({ latlng: [[1, 2]], distance: [0], altitude: [] })
  })
})
