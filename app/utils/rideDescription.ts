import type { BikeCategory } from '../../shared/types/catalog'

export interface RideDescriptionInputs {
  /** "Tempus Fugit", or "the Alpe du Zwift climb" on a segment page. */
  ride: string
  world: string
  /** The numbers a searcher scans for, without brackets: "19.6 km, 32 m of climbing". */
  stats: string
  /** Rank 1's frame and wheels, as the answer names them; absent when there is no ranking. */
  setup?: string
  /** The category the ranking was drawn from. */
  category: BikeCategory | 'all'
}

/** Google shows roughly this much of a description before it truncates it itself. */
const MAX_LENGTH = 160

const CATEGORY_POOL: Record<BikeCategory | 'all', string> = {
  standard: 'on road bikes',
  tt: 'on TT bikes',
  gravel: 'on gravel bikes',
  handbike: 'on hand cycles',
  funbike: 'on fun bikes',
  all: 'in every bike category'
}

/**
 * A route or segment page's meta description (issue #267): the search phrase
 * first, then the default rider's Recommendation - the part that differs
 * from page to page, where a closing phrase shared by all 440 pages used to
 * be. No time, runner-up or left-out setup, for the reason the share card
 * has none: a time is only true for one rider, and a snippet cannot say
 * which.
 *
 * Past 160 characters it drops "in {world}" first, then the bracketed
 * stats, because those are what a searcher can do without; the setup name
 * is the answer and is never cut. A long route name with a long setup name
 * (21 of 439 pages on the default query) is still over after both, so the
 * category clause goes last - the ranking page states the category anyway.
 * Only a setup name too long to fit at all leaves a description over 160.
 */
export function rideDescription(inputs: RideDescriptionInputs): string {
  const tail = inputs.setup
    ? `: ZwiftBikes predicts the ${inputs.setup}, fastest ${CATEGORY_POOL[inputs.category]}.`
    : ', ranked by predicted finish time for your weight and power.'
  const world = ` in ${inputs.world}`
  const stats = ` (${inputs.stats})`
  const candidates = [
    `The best bike and wheels for ${inputs.ride}${world}${stats}${tail}`,
    `The best bike and wheels for ${inputs.ride}${stats}${tail}`,
    `The best bike and wheels for ${inputs.ride}${tail}`,
    ...(inputs.setup ? [`The best bike and wheels for ${inputs.ride}: ZwiftBikes predicts the ${inputs.setup}.`] : [])
  ]
  return candidates.find(candidate => candidate.length <= MAX_LENGTH) ?? candidates[candidates.length - 1]!
}
