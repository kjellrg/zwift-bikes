import { describe, expect, it } from 'vitest'
import type { RouteWithMeta } from '../../shared/types/catalog'
import type { RacePlanItem } from '../../shared/utils/physics/racePlan'
import { coveredSectors, tttPlanCoverage } from './tttPlan'

// Hand-built routes: the rule reads only what the fetched route object says
// about its own coverage, never the catalog.
function route(overrides: {
  elevation?: number
  leadInKm?: number
  leadInElevation?: number
  segments?: number
  leadInSegments?: number
}): RouteWithMeta {
  const points = (count: number) => Array.from({ length: count }, (_, i) => ({ distanceM: i * 100, elevationM: i }))
  const stretches = (count: number) => Array.from({ length: count }, (_, i) => ({ fromKm: i, toKm: i + 1, type: 'tarmac' as const }))
  return {
    slug: 'fixture',
    distance: 10,
    leadInDistance: overrides.leadInKm ?? 0,
    terrain: {
      elevationProfile: points(overrides.elevation ?? 20),
      leadInElevationProfile: overrides.leadInElevation ? points(overrides.leadInElevation) : undefined,
      climbs: [],
      sprints: []
    },
    surface: {
      segments: stretches(overrides.segments ?? 3),
      leadInSegments: overrides.leadInSegments ? stretches(overrides.leadInSegments) : undefined,
      confidence: 'measured'
    }
  } as unknown as RouteWithMeta
}

const sector = (type: RacePlanItem['type'], fromKm: number, toKm: number): RacePlanItem =>
  ({ type, fromKm, toKm, lengthKm: toKm - fromKm, detail: '', note: '' })

describe('tttPlanCoverage', () => {
  it('withholds the whole analysis without an elevation profile', () => {
    const coverage = tttPlanCoverage(route({ elevation: 0 }))
    expect(coverage.withheld).toBe('TTT sector analysis unavailable: elevation locations are missing.')
    expect(coveredSectors([sector('climb', 1, 3)], coverage)).toEqual([])
  })

  it('keeps climbs but drops surface sectors when the surfaces are not positioned', () => {
    const coverage = tttPlanCoverage(route({ segments: 0 }))
    expect(coverage.withheld).toBeUndefined()
    expect(coverage.caveats).toEqual(['Surface locations unavailable; only climbs can be flagged.'])
    const climb = sector('climb', 4, 6)
    expect(coveredSectors([sector('surface', 1, 2), climb], coverage)).toEqual([climb])
  })

  it('discloses a lead-in modelled from totals, and flags nothing inside it', () => {
    const coverage = tttPlanCoverage(route({ leadInKm: 2.8 }))
    expect(coverage.caveats).toEqual(['The 2.8 km lead-in is modelled from its distance and climbing totals, not a measured trace; sectors inside it are not flagged.'])
    const lapClimb = sector('climb', 5, 7)
    const acrossTheJoin = sector('surface', 2.5, 3.2)
    expect(coveredSectors([sector('climb', 0.5, 2.0), sector('surface', 1, 2.4), acrossTheJoin, lapClimb], coverage)).toEqual([acrossTheJoin, lapClimb])
  })

  it('discloses only the missing surface positions when the lead-in trace is measured', () => {
    const coverage = tttPlanCoverage(route({ leadInKm: 2.8, leadInElevation: 10 }))
    expect(coverage.caveats).toEqual(['The 2.8 km lead-in\'s surfaces are not positioned; rough sectors inside it are not flagged.'])
    const leadInClimb = sector('climb', 0.5, 2.0)
    expect(coveredSectors([leadInClimb, sector('surface', 1, 2.4)], coverage)).toEqual([leadInClimb])
  })

  it('has nothing to disclose with a measured lead-in, or a lead-in too short for a sector', () => {
    expect(tttPlanCoverage(route({ leadInKm: 10.8, leadInElevation: 41, leadInSegments: 1 })).caveats).toEqual([])
    expect(tttPlanCoverage(route({ leadInKm: 0.2 })).caveats).toEqual([])
    expect(tttPlanCoverage(route({})).caveats).toEqual([])
    const items = [sector('climb', 0.1, 0.15), sector('surface', 3, 4)]
    expect(coveredSectors(items, tttPlanCoverage(route({ leadInKm: 0.2 })))).toEqual(items)
  })
})
