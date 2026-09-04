import type { ClassifiedBikeFrame, ComboScore } from '../../shared/types/catalog'
import { UPGRADE_STAGES, classifyBikeFrame } from '../../shared/utils/classifyBikeFrame'
import { getFrameById } from '../../shared/utils/catalog'

/**
 * What upgrading this bike is worth on the route being ranked: the simulated
 * finish time at every upgrade stage, `[0..5]`.
 *
 * `ClassifiedBikeFrame.upgradeCurve` already answers the question in the
 * abstract - seconds per hour against a reference bike at 300 W, on
 * ZwiftInsider's flat bot test and its climb bot test. A rider then has to
 * interpolate between those two to guess what a stage is worth on the course
 * they actually ride, and the guess is not a small one: the Aethos S-Works
 * gains 13.7 s from a full upgrade on Tempus Fugit and 73.9 s on Road to Sky
 * for the same rider. This makes that guess for them.
 *
 * Both endpoints call this with their own `simulateAtStage`, because they
 * measure a ride differently (a segment's time is a warmed run minus its
 * warm-up). Sharing the stage walk is what keeps them from drifting apart on
 * which stages exist and which one the rider is on.
 *
 * The current stage is NOT re-simulated: it is `combo.finishTimeSec`, the
 * number the drawer prints next to this curve. Simulating it again would give
 * the same answer for the same inputs, but taking it from the combo makes the
 * curve pass through the displayed time by construction rather than by
 * coincidence, and costs one integration less.
 *
 * `undefined` when there is nothing real to draw: an unmeasured frame has no
 * per-stage data and upgrading does not move it at all, and a combo with no
 * finish time was ranked without a rider profile.
 */
export function upgradeFinishTimesSec(
  combo: ComboScore,
  simulateAtStage: (frame: ClassifiedBikeFrame) => number
): number[] | undefined {
  if (!combo.frame.upgradeCurve || typeof combo.finishTimeSec !== 'number') return undefined
  // The catalog's own stage-0 entry, which is what `classifyBikeFrame` caches
  // every other stage from - `combo.frame` is already classified at the
  // rider's stage, and re-classifying that would compound one stage onto
  // another.
  const base = getFrameById(combo.frame.id)
  if (!base) return undefined

  const currentStage = Math.min(5, Math.max(0, Math.round(combo.frame.level)))
  return UPGRADE_STAGES.map(stage => (stage === currentStage
    ? combo.finishTimeSec!
    : simulateAtStage(classifyBikeFrame(base, stage))))
}
