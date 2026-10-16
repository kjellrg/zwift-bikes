import type { RouteCardData } from '../utils/routeCards'

/**
 * The Standings (see `CONTEXT.md`): what the Bikes and Wheels pages average
 * across the routes a rider filters to. Built on the server from
 * `shared/data/standings.generated.json` (`server/utils/standings.ts`) and
 * averaged in the browser (`app/utils/standings.ts`), so a filter change
 * makes no request - the homepage's route grid works the same way.
 */

/** The two frame categories every measured frame belongs to - the pages' Road / TT switch. */
export const STANDINGS_CATEGORIES = ['standard', 'tt'] as const
export type StandingsCategory = (typeof STANDINGS_CATEGORIES)[number]

/** Which page: bikes are frames ridden on their own fastest wheels, wheels are wheelsets on each route's fastest frame. */
export type StandingsKind = 'bikes' | 'wheels'

/** One bike or wheelset as a Standings page lists it. */
export interface StandingsEntry {
  /** A frame's id, or a wheelset's key - stable across catalog renames. */
  id: string
  name: string
  /** A bike's Colourways: the same frame under other names and paint, listed once. */
  otherPaints?: string[]
  /**
   * Wheels that time identically to this one on every route - a wheel sold in
   * several paints, or two the bot tests cannot tell apart - listed once, as
   * a route page's Wheel alternatives list them.
   */
  sameTimes?: string[]
}

/**
 * One route's times for one category: how far behind that route's fastest
 * each entry finishes. For bikes the fastest is the category's fastest frame;
 * for wheels it is the fastest wheels on `timedOn`.
 */
export interface StandingsRouteTimes {
  /** The fastest time on the route, in seconds - what a gap is a share of. */
  fastestSec: number
  /**
   * Per entry, in the entries' order and comma-separated: tenths of a second
   * behind `fastestSec`, or nothing where the entry has no time. One string
   * rather than an array because the payload gives every array element a
   * slot of its own, and these are most of it - see the budget in
   * `server/utils/standings.test.ts`. `parseGaps` in `app/utils/standings.ts`
   * reads it back.
   */
  gapTenths: string
  /** Wheels only: the frame they were timed on - the route's fastest that takes wheels. */
  timedOn?: string
}

/** A route as the filters read it - the homepage's own card fields - with its times. */
export interface StandingsRoute extends Pick<RouteCardData, 'slug' | 'name' | 'world' | 'worldName' | 'distance' | 'elevation' | 'terrain' | 'gravel' | 'cobble'> {
  times: Partial<Record<StandingsCategory, StandingsRouteTimes>>
}

/** The rider every time was computed for: the default one the pages are prerendered with. */
export interface StandingsRider {
  weightKg: number
  heightCm: number
  powerW: number
  /** The Upgrade stage every frame is ridden at. */
  upgradeStage: number
  draftMode: string
}

/** What `/api/standings/bikes` and `/api/standings/wheels` answer. */
export interface StandingsData {
  kind: StandingsKind
  rider: StandingsRider
  /** Per category, the entries the routes' `gapTenths` are in the order of. */
  entries: Record<StandingsCategory, StandingsEntry[]>
  routes: StandingsRoute[]
  /** The worlds, in the game's own order, for the World filter. */
  worlds: { slug: string, name: string }[]
  /** Catalog routes with no times yet - added since the standings were last computed. */
  untimedRoutes: number
}
