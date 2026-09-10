import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import type { DraftMode } from '../../shared/utils/physics/draft'
import { buildRacePlan, type RacePlanItem } from '#shared/utils/physics/racePlan'
import { geometryForRouteLaps } from '#shared/utils/physics/routeGeometry'
import { coveredSectors, tttPlanCoverage, type TttPlanCoverage } from '../utils/tttPlan'

/** The TTT plan (see `CONTEXT.md`): the Ride's sectors for the applied setup, with what the model could not analyse beside them. */
export interface TttPlan {
  /** The sectors the coverage stands behind, in ride order. Empty until a setup is ranked (`hasSetup`), and empty when nothing is flagged. */
  sectors: RacePlanItem[]
  coverage: TttPlanCoverage
  /** Whether a ranked setup exists to quote the sectors for - with zero matches the plan returns with the first match. */
  hasSetup: boolean
  /** Whether the first ranking is still pending, so "no setup" is a loading state rather than zero matches. */
  loading: boolean
  /** The team the sectors are priced for, from the stored profile. */
  riders: number
  climbWkg?: number
}

/**
 * The one TTT plan a page computes, which the briefing's TTT line and the
 * plan tab both read - so a lap or rider refresh can never leave the two
 * describing different results. Built from the APPLIED inputs: the top combo
 * on screen, the power and lap count it was ranked at (a segment passes 1).
 * During a refresh those keep their previous values, so the plan keeps
 * describing the results still on screen, as the recommendation does.
 * Undefined outside TTT drafting: race drafting models a bunch, not a
 * paceline, and has no plan.
 */
export function useTttPlan(inputs: {
  route: () => RouteWithMeta | undefined
  combo: () => ComboScore | undefined
  powerW: () => number
  laps: () => number
  draftMode: () => DraftMode
  /** Whether the first ranking is still pending - nothing on screen yet, as opposed to zero matches. */
  loading: () => boolean
}) {
  // Weight, height and the team inputs are read live from the stored
  // profile (the request exposes no applied copy of them), so a profile
  // edit reprices the sectors at once while the combo and power lag until
  // the refetch lands - the same as the speed chart. Both readers of the
  // plan see the same value either way.
  const { weightKg, heightCm, tttRiders, tttClimbWkg } = useRiderProfile()

  return computed<TttPlan | undefined>(() => {
    const route = inputs.route()
    if (!route || inputs.draftMode() !== 'ttt') return undefined
    const coverage = tttPlanCoverage(route)
    const combo = inputs.combo()
    // Pure closed-form (no simulation - see `buildRacePlan`), cheap enough to compute eagerly.
    const sectors = combo && !coverage.withheld
      ? coveredSectors(buildRacePlan(geometryForRouteLaps(route, inputs.laps()), {
          weightKg: weightKg.value,
          heightCm: heightCm.value,
          riderPowerW: inputs.powerW(),
          climbWkg: tttClimbWkg.value,
          riders: tttRiders.value,
          frame: combo.frame,
          wheelset: combo.wheelset
        }), coverage)
      : []
    return { sectors, coverage, hasSetup: Boolean(combo), loading: inputs.loading(), riders: tttRiders.value, climbWkg: tttClimbWkg.value }
  })
}
