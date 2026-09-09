import type { BikeCategory, ComboScore } from '../../shared/types/catalog'
import type { DraftMode } from '../../shared/utils/physics/draft'
import { buildRecommendationAnswer, type RecommendationAnswer } from '../utils/recommendationAnswer'

export interface RecommendationAnswerOptions {
  /** The fastest combo on screen - the answer is about it, and there is none without it. */
  combo: () => ComboScore | undefined
  /** "Watopia Hilly Route in Watopia"; undefined until the page's own lookup has landed. */
  rideName: () => string | undefined
  /** The distance the combo's time covers, for the km/h; a page without one omits the speed. */
  distanceKm: () => number | undefined
  /** The power and draft mode the ranking was ACTUALLY computed at - `useRecommendRequest`'s `activePowerW`/`draftMode`, not the stored profile. */
  powerW: () => number
  draftMode: () => DraftMode
  /** The category the ranking actually used, made legal for the ride (`useRecommendRequest`'s `category`). */
  category: () => BikeCategory | 'all'
  /** The applied lap count on a route page; omit on a segment page. */
  laps?: () => number
  /** The settled search term the ranking was fetched for (`bikeSearchDebounced`). */
  search: () => string
}

/**
 * The visible best-bike answer under the recommendation, and the FAQ
 * structured data's text, as one computed. Everything rider-side is read
 * from the stored state the request itself reads, and everything ride-side
 * comes from the page through the getters - so the answer describes the
 * ranking on screen, not a hypothetical one. The wording lives in
 * `buildRecommendationAnswer`, which is where it is tested.
 */
export function useRecommendationAnswer(options: RecommendationAnswerOptions) {
  const { weightKg, heightCm, tttRiders, tttClimbWkg } = useRiderProfile()
  const { myBikesOnly, verifiedOnly, includeHaloBikes } = usePreferences()
  const { owned, ownedWheels } = useGarage()

  return computed<RecommendationAnswer | undefined>(() => {
    const combo = options.combo()
    const rideName = options.rideName()
    if (!combo || !rideName || combo.finishTimeSec === undefined) return undefined
    return buildRecommendationAnswer({
      frameName: combo.frame.name,
      wheelsetName: combo.wheelset?.name,
      finishTimeSec: combo.finishTimeSec,
      distanceKm: options.distanceKm(),
      rideName,
      weightKg: weightKg.value,
      heightCm: heightCm.value,
      powerW: options.powerW(),
      draftMode: options.draftMode(),
      tttRiders: tttRiders.value,
      tttClimbWkg: tttClimbWkg.value,
      laps: options.laps?.(),
      bikeCategory: options.category(),
      verifiedOnly: verifiedOnly.value,
      includeHaloBikes: includeHaloBikes.value,
      myBikesOnly: myBikesOnly.value,
      ownsFrames: Object.keys(owned.value).length > 0,
      ownsWheels: Object.keys(ownedWheels.value).length > 0,
      search: options.search()
    })
  })
}
