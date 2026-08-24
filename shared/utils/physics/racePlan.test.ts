import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import type { RouteGeometry, RouteGeometryPoint } from '../../types/physics'
import { classifyBikeFrame } from '../classifyBikeFrame'
import { getWheelsets } from '../wheelsets'
import { TTT_MAX_CLIMB_WKG, TTT_MIN_CLIMB_WKG } from './draft'
import { buildRacePlan } from './racePlan'

function geometry(points: RouteGeometryPoint[]): RouteGeometry {
  const totalDistanceM = points[points.length - 1]!.distanceM
  return {
    routeSlug: 'test-geometry',
    points,
    surfaceSegments: [{ fromM: 0, toM: totalDistanceM, surface: 'tarmac' }],
    totalDistanceM
  }
}

// A 3 km climb at 5% inside a >5 km route (buildRacePlan skips shorter ones).
const CLIMB_GEOMETRY = geometry([
  { distanceM: 0, elevationM: 0 },
  { distanceM: 2000, elevationM: 0 },
  { distanceM: 5000, elevationM: 150 },
  { distanceM: 7000, elevationM: 150 }
])

const OPTIONS = {
  weightKg: 79,
  heightCm: 182,
  riderPowerW: 260,
  riders: 8,
  frame: classifyBikeFrame(bikeFrames.find(f => f.name === 'Zwift Carbon')!, 0),
  wheelset: getWheelsets().find(w => w.name === 'Zwift 32mm Carbon')!
}

describe('race plan climb rows are independent of the climb pace', () => {
  it('the climb row survives every climb pace the slider allows', () => {
    // Regression: the row used to be detected at the CLIMB power, so raising
    // the team climb pace past the block's speed cutoff silently deleted it
    // from the panel (Greater London 8, >= ~4.0 W/kg).
    const reference = buildRacePlan(CLIMB_GEOMETRY, OPTIONS).find(item => item.type === 'climb')
    expect(reference).toBeDefined()
    for (let climbWkg = TTT_MIN_CLIMB_WKG; climbWkg <= TTT_MAX_CLIMB_WKG; climbWkg += 0.5) {
      const climb = buildRacePlan(CLIMB_GEOMETRY, { ...OPTIONS, climbWkg }).find(item => item.type === 'climb')
      expect(climb, `${climbWkg} W/kg`).toBeDefined()
      expect([climb!.fromKm, climb!.toKm], `${climbWkg} W/kg`).toEqual([reference!.fromKm, reference!.toKm])
      expect(climb!.note).toContain(`${climbWkg.toFixed(1)} W/kg`)
    }
  })

  it('the estimated duration reflects the pace the climb is actually ridden at', () => {
    const easy = buildRacePlan(CLIMB_GEOMETRY, { ...OPTIONS, climbWkg: 3 }).find(item => item.type === 'climb')!
    const hard = buildRacePlan(CLIMB_GEOMETRY, { ...OPTIONS, climbWkg: 8 }).find(item => item.type === 'climb')!
    const minutes = (item: { detail: string }) => Number(/est\. (\d+) min/.exec(item.detail)![1])
    expect(minutes(hard)).toBeLessThan(minutes(easy))
  })
})
