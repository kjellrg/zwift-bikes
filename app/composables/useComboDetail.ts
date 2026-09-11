import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import type { BikeDetail } from './useOverlays'

export interface ComboDetailSource {
  combo: () => ComboScore
  route: () => RouteWithMeta | undefined
  laps: () => number | undefined
  fastestTimeSec: () => number | undefined
  loadFrameCombos: () => BikeDetail['loadFrameCombos']
  requestKey: () => string | undefined
}

/**
 * The bike drawer's side of a result row: how to open the drawer for this
 * combo, and the watcher that keeps an open drawer following this row's
 * combo across refetches. Shared by the recommendation block and every
 * ranked row so the two can't disagree about what a drawer is opened with.
 *
 * The watcher is immediate on purpose: a refetch can move a bike between
 * component instances rather than update one in place (the fastest combo renders in its own slot, the rest
 * keyed by frame and wheelset), so only a watcher that also runs on mount
 * reaches a drawer whose bike just became the fastest. `syncBikeDetail`
 * itself ignores every combo but the drawer's own.
 */
export function useComboDetail(source: ComboDetailSource) {
  const { openBikeDetail, syncBikeDetail } = useOverlays()

  function detail(): BikeDetail {
    return {
      combo: source.combo(),
      route: source.route(),
      laps: source.laps(),
      fastestTimeSec: source.fastestTimeSec(),
      loadFrameCombos: source.loadFrameCombos(),
      requestKey: source.requestKey()
    }
  }

  // `requestKey` is watched alongside the combo rather than left to arrive
  // with it: a refetch hands the row a new combo eventually, but the drawer's
  // curve can start reloading the moment the ride it describes changes.
  watch(
    () => [source.combo(), source.fastestTimeSec(), source.laps(), source.requestKey()],
    () => syncBikeDetail(detail()),
    { immediate: true }
  )

  return { openDetail: () => openBikeDetail(detail()) }
}
