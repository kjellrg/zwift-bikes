import { describe, expect, it } from 'vitest'
import { getFrames, getRouteBySlug } from '../catalog'
import { getWheelsets } from '../wheelsets'
import { resolveDraft } from './draft'
import { geometryForRouteLaps } from './routeGeometry'
import { computeRouteSurfaceSpeedProfile } from './routeSurfaceSpeedProfile'
import { simulateRoute } from './simulator'

const setup = {
  frame: getFrames().find(candidate => candidate.name === 'Zwift Carbon')!,
  wheelset: getWheelsets().find(candidate => candidate.name === 'Zwift 32mm Carbon')!
}
const rider = { weightKg: 75, heightCm: 175, powerW: 225 }

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
  const geometry = geometryForRouteLaps(getRouteBySlug('jungle-circuit')!, 1)

  it('runs one simulation per profile, and a second only for a drafted ride\'s solo line', () => {
    const solo = recording()
    const profile = computeRouteSurfaceSpeedProfile(geometry, setup, rider, resolveDraft({ mode: 'solo' }, geometry, rider), {}, solo.simulate)
    expect(solo.calls).toHaveLength(1)
    expect(profile.soloComparison).toBeUndefined()

    const race = recording()
    expect(computeRouteSurfaceSpeedProfile(geometry, setup, rider, resolveDraft({ mode: 'race' }, geometry, rider), {}, race.simulate).soloComparison).toBeDefined()
    expect(race.calls).toHaveLength(2)
    expect(race.calls[1]!.powerScaleAtSpeed).toBeUndefined()
  })

  it('enters the geometry at the speed it is handed, drafted and solo', () => {
    const race = recording()
    computeRouteSurfaceSpeedProfile(geometry, setup, rider, resolveDraft({ mode: 'race' }, geometry, rider), { initialSpeedMps: 11, soloInitialSpeedMps: 9 }, race.simulate)
    expect(race.calls.map(call => call.initialSpeedMps)).toEqual([11, 9])
  })

  it('prices each surface the way the Surfaces tab shows it, from the chart\'s own segments', () => {
    const profile = computeRouteSurfaceSpeedProfile(geometry, setup, rider, resolveDraft({ mode: 'solo' }, geometry, rider))
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
