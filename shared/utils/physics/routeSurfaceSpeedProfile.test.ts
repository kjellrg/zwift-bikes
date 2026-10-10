import { describe, expect, it } from 'vitest'
import { getFrames, getRouteBySlug } from '../catalog'
import { getWheelsets } from '../wheelsets'
import { computeRouteSurfaceSpeedProfile } from './routeSurfaceSpeedProfile'
import { simulateRoute } from './simulator'

const frame = getFrames().find(candidate => candidate.name === 'Zwift Carbon')!
const wheelset = getWheelsets().find(candidate => candidate.name === 'Zwift 32mm Carbon')!

function recording() {
  const calls: Parameters<typeof simulateRoute>[0][] = []
  const simulate: typeof simulateRoute = (options) => {
    calls.push(options)
    return simulateRoute(options)
  }
  return { calls, simulate }
}

describe('computeRouteSurfaceSpeedProfile', () => {
  // Jungle Circuit: dirt and tarmac at measured positions, so every surface
  // the extra watts are averaged over is one the chart's strip draws.
  const jungle = getRouteBySlug('jungle-circuit')!

  it('runs one simulation per profile, and a second only for a drafted ride\'s solo line', () => {
    const solo = recording()
    const profile = computeRouteSurfaceSpeedProfile(jungle, frame, wheelset, 75, 175, 225, { mode: 'solo' }, solo.simulate)
    expect(profile).toBeDefined()
    expect(solo.calls).toHaveLength(1)
    expect(profile!.soloComparison).toBeUndefined()

    const race = recording()
    expect(computeRouteSurfaceSpeedProfile(jungle, frame, wheelset, 75, 175, 225, { mode: 'race' }, race.simulate)!.soloComparison).toBeDefined()
    expect(race.calls).toHaveLength(2)
  })

  it('prices each surface the way the Surfaces tab shows it, from the chart\'s own segments', () => {
    const profile = computeRouteSurfaceSpeedProfile(jungle, frame, wheelset, 75, 175, 225, { mode: 'solo' })!
    const totals: Record<string, { watts: number, km: number }> = {}
    for (const segment of profile.segments) {
      const total = totals[segment.surface] ??= { watts: 0, km: 0 }
      total.watts += segment.extraWattsVsTarmac * (segment.toKm - segment.fromKm)
      total.km += segment.toKm - segment.fromKm
    }
    expect(Object.keys(profile.extraWattsBySurface).sort()).toEqual(Object.keys(totals).sort())
    for (const [surface, total] of Object.entries(totals)) {
      expect(profile.extraWattsBySurface[surface as keyof typeof profile.extraWattsBySurface]).toBe(Math.round(total.watts / total.km))
    }
    expect(profile.extraWattsBySurface.tarmac).toBe(0)
    expect(profile.extraWattsBySurface.dirt).toBeGreaterThan(0)
  })
})
