import type { ClassifiedBikeFrame, Wheelset } from '../../types/catalog'
import { equipmentPhysics } from './equipment'

/** A frame+wheelset pairing, as the recommend endpoints hold them. */
export interface OrderableCombo {
  frame: ClassifiedBikeFrame
  wheelset?: Wheelset
}

/**
 * How far past the requested page the endpoints re-order by real simulated
 * time. The pool arrives ordered by `estimateFinishTimeSec`, which disagrees
 * with the simulator about more than a constant offset: the estimate applies
 * the route's average grade uniformly, charging a rider for climbing every
 * metre of a rolling loop without ever giving the descent back, so it
 * overweights bike mass. Measured against simulating everything, the true
 * first three pages were never deeper than rank 90 in the estimate's
 * ordering (worst case: Canopies and Coastlines filtered to road frames);
 * every other route/category tested sat between 27 and 51. 45 past the page
 * covers the first page everywhere tested with room to spare, and the margin
 * travels with the page as a rider pages deeper.
 *
 * Cost note: this margin is deliberately flat, and on very long routes it is
 * the dominant cost of a request - roughly 2.5s for a page of Zwift Gran
 * Fondo (97.5km) versus ~50ms on a 2km circuit, since simulation cost scales
 * with route duration. That's an accepted trade: the short routes people
 * actually ride most are cheap, and getting the order right matters more than
 * the tail latency of the longest route in the game.
 *
 * If that tail ever does need fixing, the lever is to key this on route
 * length rather than lowering it across the board. How deep the estimate has
 * to be searched does NOT track route length - it tracks how tightly packed
 * the field is. Gran Fondo's combos are 10-210s apart, so a margin of 18 was
 * measured to still be inversion-free there (~1.6s); Canopies' are fractions
 * of a second apart, and the same 18 put a 1.6s inversion back on page one.
 */
export const SIMULATED_ORDER_MARGIN = 45

/**
 * Re-orders the head of `combos` by real simulated finish time, returning the
 * new ordering along with every time it computed so callers don't simulate
 * the same combo twice.
 *
 * Why a window rather than the whole pool: the endpoints display simulated
 * times but paginate a pool of ~11k candidates, and simulating all of them
 * costs seconds. Ordering the pool by the cheap estimate while displaying
 * simulated times is what let a combo the simulator ranks 2nd sit on page
 * two, showing up under "Show more matches" faster than bikes above it.
 *
 * Fitting a cheap surrogate to the simulator was tried first and is not good
 * enough: within a single bike category the whole field can be ~3s apart, and
 * no fit over CdA/mass resolves that. Only real simulations do, so the window
 * is simulated for real - and the combos on the page are in it, so the page
 * costs nothing extra.
 *
 * Combos past the window keep their incoming order. They are far enough down
 * that no rider reaches them before the margin has moved with the page.
 */
export function orderBySimulatedTime<T extends OrderableCombo>(
  combos: T[],
  windowSize: number,
  simulateSeconds: (combo: T) => number
): { ordered: T[], simulatedSec: Map<T, number> } {
  // Physically identical candidates (cosmetic re-skins, colourways, and any
  // frame whose wheels are fixed) simulate to the same time, so one run
  // covers all of them.
  const byPhysics = new Map<string, number>()
  const simulatedSec = new Map<T, number>()

  const head = combos.slice(0, Math.max(0, windowSize))
  for (const combo of head) {
    const { cdaM2, bikeMassKg } = equipmentPhysics(combo.frame, combo.wheelset)
    const physicsKey = `${cdaM2}|${bikeMassKg}|${combo.wheelset?.crrClass ?? 'road'}`
    let seconds = byPhysics.get(physicsKey)
    if (seconds === undefined) {
      seconds = simulateSeconds(combo)
      byPhysics.set(physicsKey, seconds)
    }
    simulatedSec.set(combo, seconds)
  }

  head.sort((a, b) => simulatedSec.get(a)! - simulatedSec.get(b)!)
  return { ordered: [...head, ...combos.slice(head.length)], simulatedSec }
}
