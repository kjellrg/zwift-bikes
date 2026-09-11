import type { AsyncDataRequestStatus } from '#app'

/**
 * Which of Garage fallback's four cases the rider is in (see `CONTEXT.md`):
 * "my garage only" restricts frames and wheels independently, so a garage
 * with frames but no wheels ranks the rider's frames against every
 * compatible wheel, and an empty garage restricts nothing at all.
 */
export type GarageFallback = 'full' | 'framesOnly' | 'wheelsOnly' | 'empty'

export function garageFallback(owns: { frames: boolean, wheels: boolean }): GarageFallback {
  if (!owns.frames && !owns.wheels) return 'empty'
  if (!owns.frames) return 'wheelsOnly'
  if (!owns.wheels) return 'framesOnly'
  return 'full'
}

/**
 * What each case ranks, as the equipment filters state it beside the switch.
 * The garage reads the same four cases to explain an empty tab, so the rule
 * lives here rather than in either reader: a restriction the rider cannot
 * see is one they will blame the ranking for, and two readers that disagree
 * about which half fell back are worse than one.
 */
export const GARAGE_FALLBACK_SCOPES: Record<GarageFallback, string> = {
  full: 'Your frames / your wheels',
  framesOnly: 'Your frames / all wheels',
  wheelsOnly: 'All frames / your wheels',
  empty: 'Garage empty - showing all equipment'
}

/**
 * What the garage shows in place of one of its two lists, or the list
 * itself. The catalog fetches behind them are unawaited (see
 * `GarageContent`), so `'idle'` is still loading - the first request is not
 * even in flight yet - and a failed fetch empties the data it would have
 * filled, which is why the failure is read before anything that would
 * otherwise call the emptied list "no match".
 *
 * `emptyCollection` is the rider's own doing rather than the search's: "only
 * show what I own" with nothing owned in this tab. Saying so is what
 * separates a garage that is empty from a search that found nothing, which
 * the one "No bikes match your search." line could not.
 */
export type GarageListStatus = 'loading' | 'failed' | 'emptyCollection' | 'noMatch' | 'list'

export function garageListStatus(list: {
  /** The tab's own catalog fetch. */
  status: AsyncDataRequestStatus
  /** Whether the tab's "only show what I own" switch is on. */
  ownedOnly: boolean
  /** Whether the rider owns anything in THIS collection - frames on the bikes tab, wheels on the wheels tab. */
  ownsCollection: boolean
  /** How many rows would be listed. */
  visible: number
}): GarageListStatus {
  if (list.status === 'error') return 'failed'
  if (list.status === 'idle' || list.status === 'pending') return 'loading'
  if (list.ownedOnly && !list.ownsCollection) return 'emptyCollection'
  return list.visible === 0 ? 'noMatch' : 'list'
}
