import type { ComboScore } from '../../shared/types/catalog'
import type { RecommendRide } from '../../shared/types/recommendRide'
import type { AppliedRiderInputs } from '../utils/recommendRequest'
import { draftOf, resolveDraft } from '#shared/utils/physics/draft'
import { buildRacePlan, type RacePlanItem } from '#shared/utils/physics/racePlan'
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
 * The one TTT plan a page computes, which the Fact row's TTT line and the
 * plan tab both read - so a lap or rider refresh can never leave the two
 * describing different results. Built from the APPLIED inputs: the Recommendation
 * on screen, the rider it was ranked for, and the Ride it was ranked on.
 * During a refresh those keep their previous values, so the plan keeps
 * describing the results still on screen, as the recommendation does.
 *
 * The sectors, and the Draft they are priced under, are read off the Ride's
 * own geometry (`RecommendRide.planGeometry`) - the one its times were
 * simulated over and its Draft resolved on, as the server does. A segment is
 * a segment's own stretch of road entered at speed, never a lap of a route,
 * so the plan cannot be rebuilt from the course and a lap count (issue #284).
 *
 * Undefined outside TTT drafting: race drafting models a bunch, not a
 * paceline, and has no plan.
 */
export function useTttPlan(inputs: {
  /** The Applied Ride resolved against its course, as the server times it - `resolveRankingPageRide`. */
  ride: () => RecommendRide | undefined
  combo: () => ComboScore | undefined
  /** The rider the combo was ranked for - `useRecommendRequest().appliedInputs`. */
  rider: () => AppliedRiderInputs
  /** Whether the first ranking is still pending - nothing on screen yet, as opposed to zero matches. */
  loading: () => boolean
}) {
  return computed<TttPlan | undefined>(() => {
    const ride = inputs.ride()
    const rider = inputs.rider()
    if (!ride || rider.draftMode !== 'ttt') return undefined
    const coverage = tttPlanCoverage(ride)
    const combo = inputs.combo()
    // Pure closed-form (no simulation - see `buildRacePlan`), cheap enough to compute eagerly.
    const sectors = combo && !coverage.withheld
      ? coveredSectors(sectorsFor(ride, rider, combo), coverage)
      : []
    return { sectors, coverage, hasSetup: Boolean(combo), loading: inputs.loading(), riders: rider.tttRiders, climbWkg: rider.tttClimbWkg }
  })
}

/** The plan's sectors, with the applied draft resolved on the same Ride geometry the plan is built on - the one rule `RacePlanOptions.draft` asks for. */
function sectorsFor(ride: RecommendRide, rider: AppliedRiderInputs, combo: ComboScore): RacePlanItem[] {
  const geometry = ride.planGeometry()
  return buildRacePlan(geometry, {
    weightKg: rider.weightKg,
    heightCm: rider.heightCm,
    riderPowerW: rider.powerW,
    draft: resolveDraft(draftOf(rider), geometry, rider),
    frame: combo.frame,
    wheelset: combo.wheelset
  })
}
