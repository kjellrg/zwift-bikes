import type { ComboScore } from '../../shared/types/catalog'
import type { AppliedRiderInputs, RiderInputs } from '../utils/recommendRequest'
import { buildRecommendationAnswer, type RecommendationAnswer } from '../utils/recommendationAnswer'

export interface RecommendationAnswerOptions {
  /** The fastest combo on screen - the answer is about it, and there is none without it. */
  combo: () => ComboScore | undefined
  /** "Watopia Hilly Route in Watopia"; undefined until the page's own lookup has landed. */
  rideName: () => string | undefined
  /** The distance the combo's time covers, for the km/h; a page without one omits the speed. */
  distanceKm: () => number | undefined
  /** The rider the results on screen were computed for - `useRecommendRequest`'s `appliedInputs`, never the stored profile. */
  rider: () => AppliedRiderInputs
  /** The applied lap count on a route page; omit on a segment page. */
  laps?: () => number
  restrictions: () => RiderInputs
  /** The Ride's own equipment and drafting rules, ahead of the answer - a race has them, a route does not. */
  rideRules?: () => string | undefined
}

/**
 * The visible best-bike answer under the recommendation, and the FAQ
 * structured data's text, as one computed. The rider side is the applied
 * snapshot the page hands over, the pool restrictions are captured by the
 * accepted request, and everything ride-side comes from
 * the page through the getters - so the answer describes the ranking on
 * screen, not the one the controls are about to ask for. The wording lives
 * in `buildRecommendationAnswer`, which is where it is tested.
 */
export function useRecommendationAnswer(options: RecommendationAnswerOptions) {
  return computed<RecommendationAnswer | undefined>(() => {
    const combo = options.combo()
    const rideName = options.rideName()
    const restrictions = options.restrictions()
    if (!combo || !rideName || combo.finishTimeSec === undefined) return undefined
    return buildRecommendationAnswer({
      frameName: combo.frame.name,
      wheelsetName: combo.wheelset?.name,
      finishTimeSec: combo.finishTimeSec,
      distanceKm: options.distanceKm(),
      rideName,
      rider: options.rider(),
      laps: options.laps?.(),
      rideRules: options.rideRules?.(),
      verifiedOnly: restrictions.verifiedOnly,
      includeHaloBikes: restrictions.includeHaloBikes,
      myBikesOnly: restrictions.myBikesOnly,
      ownsFrames: Object.keys(restrictions.owned).length > 0,
      ownsWheels: Object.keys(restrictions.ownedWheels).length > 0,
      search: restrictions.search
    })
  })
}
