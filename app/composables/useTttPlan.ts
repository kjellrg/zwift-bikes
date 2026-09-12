import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import type { AppliedRiderInputs } from '../utils/recommendRequest'
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
  /** The team the sectors are priced for, from the applied rider. */
  riders: number
  climbWkg?: number
}

/**
 * The one TTT plan a page computes, which the briefing's TTT line and the
 * plan tab both read - so a lap or rider refresh can never leave the two
 * describing different results. Built from the APPLIED inputs: the top combo
 * on screen, the rider and lap count it was ranked at (a segment passes 1).
 * During a refresh those keep their previous values, so the plan keeps
 * describing the results still on screen, as the recommendation does.
 * Undefined outside TTT drafting: race drafting models a bunch, not a
 * paceline, and has no plan.
 */
export function useTttPlan(inputs: {
  route: () => RouteWithMeta | undefined
  combo: () => ComboScore | undefined
  /** The rider the combo was ranked for - `useRecommendRequest().appliedInputs`. */
  rider: () => AppliedRiderInputs
  laps: () => number
  /** Whether the first ranking is still pending - nothing on screen yet, as opposed to zero matches. */
  loading: () => boolean
}) {
  return computed<TttPlan | undefined>(() => {
    const route = inputs.route()
    const rider = inputs.rider()
    if (!route || rider.draftMode !== 'ttt') return undefined
    const coverage = tttPlanCoverage(route)
    const combo = inputs.combo()
    // Pure closed-form (no simulation - see `buildRacePlan`), cheap enough to compute eagerly.
    const sectors = combo && !coverage.withheld
      ? coveredSectors(buildRacePlan(geometryForRouteLaps(route, inputs.laps()), {
          weightKg: rider.weightKg,
          heightCm: rider.heightCm,
          riderPowerW: rider.powerW,
          climbWkg: rider.tttClimbWkg,
          riders: rider.tttRiders,
          frame: combo.frame,
          wheelset: combo.wheelset
        }), coverage)
      : []
    return { sectors, coverage, hasSetup: Boolean(combo), loading: inputs.loading(), riders: rider.tttRiders, climbWkg: rider.tttClimbWkg }
  })
}
