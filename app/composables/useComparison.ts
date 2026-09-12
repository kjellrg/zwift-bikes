import type { ComboScore } from '../../shared/types/catalog'
import { COMPARISON_LIMIT, comboKey, toggleComparison } from '../utils/comparison'

/** The `id` of the comparison section, for the "Show comparison" buttons that jump to it. */
export const COMPARISON_ID = 'ride-comparison'

/**
 * What "Show comparison" does, from the recommendation and from the ranking
 * header alike: goes to the comparison rather than opening anything, which is
 * the reason the section stays in the page's flow.
 */
export const showComparison = () => scrollToSection(COMPARISON_ID)

/**
 * The side-by-side comparison's picks on a ranking page: `comboKey`s in pick
 * order, and the combos they stand for, looked up on the LOADED list rather
 * than copied - so a refetch that re-times a picked setup shows the new
 * time, and one that drops it drops it from the comparison. The rules of
 * picking (limit, order, no eviction) are `toggleComparison`'s; this is only
 * the state, shared by every ranking page so they can't drift.
 *
 * `includes`/`toggle`/`full` answer for one setup what the checkbox beside it
 * needs to know. The recommendation is rank 1 of the same Ranking, so it
 * picks through them exactly as a row does.
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
    full: computed(() => keys.value.length >= COMPARISON_LIMIT),
    includes: (combo: ComboScore) => keys.value.includes(comboKey(combo)),
    toggle: (combo: ComboScore) => {
      keys.value = toggleComparison(keys.value, comboKey(combo))
    },
    clear: () => {
      keys.value = []
    },
    remove: (key: string) => {
      keys.value = keys.value.filter(item => item !== key)
    }
  }
}
