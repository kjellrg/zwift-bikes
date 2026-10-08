import { routes } from 'zwift-data'

/**
 * Event lead-in corrections for the handful of routes where Zwift's own
 * published figure is wrong.
 *
 * **The default is always zwift-data.** `Route.leadInDistance` comes straight
 * from Zwift's game dictionary (`leadinDistanceInMeters` at
 * <https://www.zwift.com/zwift-web-pages/gamedictionary>, copied verbatim by
 * zwift-data's `prepare-route.mjs`), and for the overwhelming majority of
 * routes it is right and no entry belongs here. This table exists for the edge
 * cases where riding the route proves otherwise, and every entry has to carry
 * the evidence that put it here.
 *
 * **How the bad ones were found.** Urumaze predicted 5.78% fast against 152
 * real finishers, and the missing distance was mistaken for a rolling-
 * resistance problem for a week - see `docs/race-drafting.md` §5, "What sand
 * turned out not to be".
 *
 * There is no tell in the source data itself, which is the point. Zwift
 * publishes `85.2417526245` m for Urumaze, Mech Isle Mayhem and Mech Isle Loop
 * Run, and it is tempting to read one value across three routes as a copied
 * placeholder - but sharing is normal and proves nothing: 147 of the 393
 * routes in the dictionary share a lead-in with at least one other route,
 * usually because they start from the same pen (six London routes share
 * 462.1 m). The field looks entirely well-formed. It is only wrong when
 * compared against something ridden.
 *
 * **The rule for adding an entry.** Only for `eventOnly` routes, and only with
 * one of:
 *
 * 1. A published event distance from the organiser (ZwiftInsider, ZRacing,
 *    WTRL). Subtract `laps x route.distance` and the remainder is the lead-in.
 * 2. A Strava segment effort: an activity's total distance minus the route
 *    segment's own distance, provided the rider stopped at the line. Build one
 *    with `scripts/race-draft/add-segment-effort.mjs`.
 *
 * Never from a solve against finish times alone. That is what produced the
 * sand mistake: a missing kilometre and a slow surface are the same flat
 * percentage offset, and fitting either one will "work".
 *
 * **The standing check, for whoever curates the next event season:** for every
 * `eventOnly` route, compare the organiser's published distance against
 * `route.distance x laps + route.leadInDistance` BEFORE trusting our number.
 * `scripts/events/validate-events.mjs` already does this and warns; that
 * warning is a finding, not noise. Twenty event-only cycling routes still
 * carry sub-200 m lead-ins and have never been checked against a published
 * event distance.
 */
export interface EventLeadInOverride {
  /** Ridden distance from the event pen to the route's start line, km. */
  distanceKm: number
  /** Elevation gain over that lead-in, m. Derived the same way as the distance, so it inherits the published figure's rounding. */
  elevationM: number
  /** Where the number came from, specifically enough to re-check it. */
  source: string
  checkedAt: string
}

export const EVENT_LEAD_IN_OVERRIDES: Record<string, EventLeadInOverride> = {
  // Empty since 2026-10-08. The three entries it held - Mech Isle Mayhem
  // (2.063 km), Urumaze (2.046 km) and Twilight Crit (1.680 km), each from
  // the ZRacing 2026 Makuri Madness published distances - left when Zwift
  // corrected its own figures (zwift-data 2.1: 2.031, 2.031 and 1.839 km),
  // which agree with ours to within the organiser's rounding, and flipped
  // those routes off `eventOnly`, so `eventLeadIn()` would no longer apply
  // them anyway. The rule above stands; the table waits for the next case.
}

const eventOnlySlugs = new Set(routes.filter(route => route.eventOnly).map(route => route.slug))

/**
 * The lead-in to use for a route, correction applied where one exists.
 * Restricted to `eventOnly` routes because the correction describes an event
 * pen: a free ride or a meetup on the same route starts somewhere else
 * entirely (Zwift publishes separate `leadInDistanceFreeRide`/`Meetups`
 * figures, and those are not disputed).
 */
export function eventLeadIn(slug: string, leadInDistance?: number, leadInElevation?: number): { leadInDistance?: number, leadInElevation?: number } {
  const override = EVENT_LEAD_IN_OVERRIDES[slug]
  if (!override || !eventOnlySlugs.has(slug)) return { leadInDistance, leadInElevation }
  return { leadInDistance: override.distanceKm, leadInElevation: override.elevationM }
}
