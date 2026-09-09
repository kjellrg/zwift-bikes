import type { RouteWithMeta } from '../../shared/types/catalog'
import type { RacePlanItem } from '../../shared/utils/physics/racePlan'
import { MIN_SURFACE_SECTOR_M } from '#shared/utils/physics/racePlan'
import { formatDistance } from './labels'

/**
 * What the TTT plan could not analyse on a Ride, disclosed beside its
 * sectors. `buildRacePlan` itself runs on whatever geometry it is given, and
 * `geometryForRouteLaps` fills every gap in the measured data with a
 * synthetic shape - a straight lead-in at the official average grade, the
 * surface mix spread along made-up positions - so a sector the model
 * "found" in a gap is an artefact of the fill, not the road. The rule here
 * is what keeps the plan honest about that.
 */
export interface TttPlanCoverage {
  /** Set when no sector can be analysed at all - the message shown in place of a plan. */
  withheld?: string
  /** Whether rough-surface sectors can be flagged on the lap: only with positioned surfaces. Climbs need only the elevation profile. */
  lapSurfaces: boolean
  /**
   * What can be flagged inside the lead-in, present only when the lead-in
   * is long enough to hold a sector at all and one of its measurements is
   * missing. `km` is where the lead-in ends, in ride kilometres.
   */
  leadIn?: { km: number, climbs: boolean, surfaces: boolean }
  /** The disclosures, in rider words, for the briefing and the plan tab. */
  caveats: string[]
}

export function tttPlanCoverage(route: RouteWithMeta): TttPlanCoverage {
  if ((route.terrain.elevationProfile?.length ?? 0) < 2) {
    return { withheld: 'TTT sector analysis unavailable: elevation locations are missing.', lapSurfaces: false, caveats: [] }
  }
  const lapSurfaces = (route.surface.segments?.length ?? 0) > 0
  const caveats: string[] = []
  if (!lapSurfaces) caveats.push('Surface locations unavailable; only climbs can be flagged.')

  // A lead-in shorter than a sector cannot hide one, whatever it is modelled from.
  const leadInKm = route.leadInDistance ?? 0
  const leadInMeasured = {
    climbs: (route.terrain.leadInElevationProfile?.length ?? 0) >= 2,
    surfaces: (route.surface.leadInSegments?.length ?? 0) > 0
  }
  const leadIn = leadInKm * 1000 >= MIN_SURFACE_SECTOR_M && !(leadInMeasured.climbs && leadInMeasured.surfaces)
    ? { km: leadInKm, ...leadInMeasured }
    : undefined
  if (leadIn && !leadIn.climbs) {
    caveats.push(`The ${formatDistance(leadIn.km)} lead-in is modelled from its distance and climbing totals, not a measured trace; sectors inside it are not flagged.`)
  } else if (leadIn && lapSurfaces) {
    // With no lap surfaces either, the caveat above already covers every rough sector.
    caveats.push(`The ${formatDistance(leadIn.km)} lead-in's surfaces are not positioned; rough sectors inside it are not flagged.`)
  }
  return { lapSurfaces, leadIn, caveats }
}

/** The sectors the coverage allows the plan to stand behind - see `TttPlanCoverage`. A sector reaching past the lead-in's end is on measured road and stays. */
export function coveredSectors(items: RacePlanItem[], coverage: TttPlanCoverage): RacePlanItem[] {
  if (coverage.withheld) return []
  return items.filter((item) => {
    if (item.type === 'surface' && !coverage.lapSurfaces) return false
    const leadIn = coverage.leadIn
    if (!leadIn || item.toKm > leadIn.km) return true
    return item.type === 'climb' ? leadIn.climbs : leadIn.surfaces
  })
}
