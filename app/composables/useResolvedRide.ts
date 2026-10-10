import type { RouteWithMeta } from '../../shared/types/catalog'
import type { Ride } from '../utils/recommendRequest'
import { resolveRankingPageRide } from '../utils/rankingPage'

/**
 * The live Ride resolved against the page's own course - the route over the
 * laps the selector shows, or the segment on its own geometry - for what a
 * Ranking page states on its own: the Course hero. It is the counterpart of
 * the Applied Ride `useRankingPage` resolves for everything that explains a
 * time; both go through `resolveRankingPageRide`, so the hero draws the
 * geometry the ranking rides.
 *
 * Memoised on its inputs' identity: the page's Ride and `useCourse`'s course
 * are stable objects until a control or a lookup moves them, so the hero's
 * profile is built once per lap count, not once per render.
 */
export function useResolvedRide(ride: () => Ride | undefined, course: () => RouteWithMeta | undefined) {
  return computed(() => resolveRankingPageRide(ride(), course()))
}
