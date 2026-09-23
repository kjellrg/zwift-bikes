import type { BikeCategory } from '../../shared/types/catalog'
import type { DraftMode } from '../../shared/utils/physics/draft'
import type { RiderInputs } from './recommendRequest'

/**
 * The homepage's live example (see issue #257): one real route answered by
 * the same recommend request a route page makes. What it shows is decided
 * here, as plain values, so the choice can be tested without Nuxt.
 *
 * The curated eight are routes with a clear, recognisable shape between them
 * - flat, a mountain, a long day, cobbles, a crit - so a visitor who lands on
 * any day sees the product answer something worth asking.
 */
export const CURATED_EXAMPLE_ROUTES = [
  'tempus-fugit',
  'road-to-sky',
  'the-mega-pretzel',
  'big-loop',
  'cobbled-climbs',
  'champs-elysees',
  'three-sisters',
  'castle-crit'
] as const

/**
 * The curated route for a calendar day (`YYYY-MM-DD`): one per day, in
 * order, the same for every visitor on that date. The prerendered page asks
 * with its build date; a browser asks with its own.
 */
export function curatedExampleRoute(isoDate: string): string {
  const day = Math.floor(Date.parse(`${isoDate}T12:00:00Z`) / 86_400_000)
  const index = ((day % CURATED_EXAMPLE_ROUTES.length) + CURATED_EXAMPLE_ROUTES.length) % CURATED_EXAMPLE_ROUTES.length
  return CURATED_EXAMPLE_ROUTES[index]!
}

/** The stored state the example is ranked for - the rider and their standing filters, never the garage. */
export interface ExampleRider {
  weightKg: number
  heightCm: number
  powerW: number
  sprintPowerW: number
  defaultUnownedLevel: number
  draftMode: DraftMode
  tttRiders: number
  tttClimbWkg: number | undefined
  verifiedOnly: boolean
  bikeCategory: BikeCategory | 'all'
  includeHaloBikes: boolean
}

/**
 * The example's request inputs. The garage and the search stay out: the
 * card shows what the site answers for a route, not what the rider happens
 * to own, and "my garage only" left on would make the homepage's one answer
 * a surprising one.
 */
export function exampleRiderInputs(rider: ExampleRider): RiderInputs {
  return { ...rider, myBikesOnly: false, owned: {}, ownedWheels: {}, search: '' }
}

/** Whose numbers the card shows, in its own words. */
export function exampleRiderLabel(rider: Pick<ExampleRider, 'weightKg' | 'powerW'>, stored: boolean): string {
  return `${stored ? 'For you' : 'For the default rider'}, ${rider.weightKg} kg at ${rider.powerW} W`
}
