import type { ComboScore } from '../../shared/types/catalog'
import { comboKey } from '../utils/comparison'

/**
 * The side-by-side comparison's picks on a ranking page: `comboKey`s in pick
 * order, and the combos they stand for, looked up on the LOADED list rather
 * than copied - so a refetch that re-times a picked setup shows the new
 * time, and one that drops it drops it from the comparison. The rules of
 * picking (limit, order, no eviction) are `toggleComparison`'s; this is only
 * the state, shared by the route and segment pages so the two can't drift.
 */
export function useComparison(combos: () => ComboScore[]) {
  const keys = ref<string[]>([])
  const picked = computed(() => keys.value
    .map(key => combos().find(combo => comboKey(combo) === key))
    .filter((combo): combo is ComboScore => combo !== undefined))
  watch(combos, (list) => {
    keys.value = keys.value.filter(key => list.some(combo => comboKey(combo) === key))
  })
  return {
    keys,
    picked,
    clear: () => {
      keys.value = []
    },
    remove: (key: string) => {
      keys.value = keys.value.filter(item => item !== key)
    }
  }
}
