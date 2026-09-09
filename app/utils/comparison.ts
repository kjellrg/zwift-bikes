/**
 * How many setups the side-by-side comparison holds. Three is what fits as
 * columns on a desktop and as a scannable stack on a phone; the prototype
 * settled on it and the ticket (#201) carries it as a requirement.
 */
export const COMPARISON_LIMIT = 3

/**
 * The comparison's selection rule: a key toggles in and out, selection order
 * is kept (the columns read in the order they were picked), and a pick past
 * the limit is refused rather than evicting the oldest - the checkbox that
 * would have made it is disabled in the UI, so this is the belt to that
 * brace. Returns a new array; the caller's list is never mutated.
 */
export function toggleComparison(selected: readonly string[], key: string, limit = COMPARISON_LIMIT): string[] {
  if (selected.includes(key)) return selected.filter(item => item !== key)
  if (selected.length >= limit) return [...selected]
  return [...selected, key]
}

/**
 * The identity a ranked row carries into the comparison and the list keys:
 * one row per frame is the list's rule (the pages send
 * `maxWheelsetsPerFrame=1`), but the wheelset is part of the key all the
 * same, so a refetch that hands a frame different wheels re-mounts its row
 * instead of updating in place - the same key the route page always used.
 */
export function comboKey(combo: { frame: { id: number }, wheelset?: { key: string } }): string {
  return `${combo.frame.id}-${combo.wheelset?.key ?? 'fixed'}`
}
